import { randomBytes } from "node:crypto";
import { UserError } from "@/core/errors.ts";

/*
 * An exec session is an interactive shell, so a one-off command is typed into
 * it, wrapped in markers the shell prints around it. The markers are written
 * as `\036` escapes, so the shell's echo of the typed line (and its prompt)
 * never contains the real marker bytes; only printf's output does. Everything
 * outside the markers is dropped, and the end marker carries the command's
 * exit status.
 */

const RS = "\x1e";
const CONNECT_TIMEOUT_MS = 15_000;

/** Quote one argument for a POSIX shell. */
export function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)
    ? arg
    : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** The line typed into the remote shell: start marker, the command, end marker with `$?`, then exit. */
export function commandLine(argv: string[], nonce: string): string {
  return `printf '\\036B${nonce}\\036'; ${argv.map(shellQuote).join(" ")}; printf '\\036E${nonce}:%d\\036' $?; exit\r`;
}

/**
 * Pulls the command's output out of the terminal stream, which also carries
 * the prompt and the echo of the typed line. Feed it decoded text as it
 * arrives; it returns what can be printed so far and, once seen, the exit code.
 */
export class MarkedOutput {
  private readonly begin: string;
  private readonly end: string;
  private started = false;
  private pending = "";
  exitCode: number | undefined;

  constructor(nonce: string) {
    this.begin = `${RS}B${nonce}${RS}`;
    this.end = `${RS}E${nonce}:`;
  }

  feed(text: string): string {
    if (this.exitCode !== undefined) return "";
    let buffer = this.pending + text;
    this.pending = "";

    if (!this.started) {
      const at = buffer.indexOf(this.begin);
      if (at === -1) {
        // Keep just enough to catch a marker split across chunks.
        this.pending = buffer.slice(-this.begin.length);
        return "";
      }
      this.started = true;
      buffer = buffer.slice(at + this.begin.length);
    }

    const at = buffer.indexOf(this.end);
    if (at !== -1) {
      const close = buffer.indexOf(RS, at + this.end.length);
      if (close === -1) {
        this.pending = buffer.slice(at);
        return normalize(buffer.slice(0, at));
      }
      this.exitCode = Number(buffer.slice(at + this.end.length, close));
      return normalize(buffer.slice(0, at));
    }

    // Hold back a tail that may be the start of the end marker, or a CR whose LF is in the next chunk.
    const last = buffer.lastIndexOf(RS);
    const keep =
      last !== -1 && this.end.startsWith(buffer.slice(last))
        ? last
        : buffer.endsWith("\r")
          ? buffer.length - 1
          : buffer.length;
    this.pending = buffer.slice(keep);
    return normalize(buffer.slice(0, keep));
  }
}

// The remote side is a terminal, so lines end in CRLF; print plain newlines like a local command would.
function normalize(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

export interface ExecCommandOptions {
  /** Receives the command's output as it arrives. */
  write: (text: string) => void;
  /** Terminal size to give the remote command, when there is one. */
  size?: { cols: number; rows: number };
  /** Aborting sends Ctrl-C to the command and closes the session. */
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  /** Overrides the random marker, for tests. */
  nonce?: string;
}

/** Run one command in the exec session's shell and resolve with its exit code. */
export function runExecCommand(
  url: string,
  token: string,
  argv: string[],
  options: ExecCommandOptions,
): Promise<number> {
  const nonce = options.nonce ?? randomBytes(6).toString("hex");
  const output = new MarkedOutput(nonce);
  const decoder = new TextDecoder();

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    let opened = false;
    let settled = false;

    const finish = (outcome: number | UserError) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      options.signal?.removeEventListener("abort", onAbort);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "done");
      if (outcome instanceof UserError) reject(outcome);
      else resolve(outcome);
    };

    function onAbort() {
      if (socket.readyState === WebSocket.OPEN) socket.send("\x03");
      finish(130);
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const connectTimer = setTimeout(() => {
      finish(
        new UserError(
          "Timed out connecting to the exec session.",
          "Check your connection and try again.",
        ),
      );
      (socket as WebSocket & { terminate?: () => void }).terminate?.();
    }, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (settled) return;
      opened = true;
      clearTimeout(connectTimer);
      socket.send(token);
      if (options.size) {
        socket.send(JSON.stringify({ type: "resize", ...options.size }));
      }
      socket.send(new TextEncoder().encode(commandLine(argv, nonce)));
    });

    socket.addEventListener("message", (event) => {
      if (settled) return;
      const { data } = event;
      const text =
        data instanceof ArrayBuffer
          ? decoder.decode(data, { stream: true })
          : String(data);
      const printable = output.feed(text);
      if (printable) options.write(printable);
      if (output.exitCode !== undefined) finish(output.exitCode);
    });

    socket.addEventListener("close", (event) => {
      if (!opened) {
        finish(
          new UserError(
            "Couldn't connect to the exec session.",
            event.reason || "The session may have expired; try again.",
          ),
        );
        return;
      }
      finish(
        new UserError(
          "The session closed before the command finished.",
          event.code === 1000 || event.code === 1006
            ? "The command may have exited the shell itself; wrap it in `sh -c '...'`."
            : `Closed with ${event.code}${event.reason ? `: ${event.reason}` : ""}.`,
        ),
      );
    });
  });
}
