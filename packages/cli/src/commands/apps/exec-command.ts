import { randomBytes } from "node:crypto";
import { UserError } from "@/core/errors.ts";
import { shellQuoteIfNeeded } from "@/core/shell.ts";
import { CONNECT_TIMEOUT_MS, terminate } from "./exec-session.ts";

// A session is a shell, so a command is typed into it between printf markers; typed as `\036` escapes, they never match the shell's echo.

const RS = "\x1e";
const NONCE_BYTES = 6;
// Shells' line editors cap a typed line (busybox: often 1024 bytes); past it the line is cut and the end marker never arrives.
export const MAX_LINE_BYTES = 1024;
// The start marker prints before the command runs, so silence this long means the shell never ran the line.
const START_TIMEOUT_MS = 15_000;
// After Ctrl-C, how long to keep printing output that is already on its way.
const ABORT_GRACE_MS = 1_000;

/** The line typed into the remote shell: start marker, the command, end marker with `$?`, then exit. */
export function commandLine(argv: string[], nonce: string): string {
  return `printf '\\036B${nonce}\\036'; ${argv.map(shellQuoteIfNeeded).join(" ")}; printf '\\036E${nonce}:%d\\036' $?; exit\r`;
}

/** Refuse a command the remote shell can't take as one typed line, before any session is opened. */
export function assertTypeable(argv: string[]): void {
  // Control characters are keystrokes to a line editor: a newline submits early, Ctrl-C/Ctrl-D cancel, a tab completes.
  const isControl = (char: string) =>
    char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f;
  if (argv.some((arg) => [...arg].some(isControl))) {
    throw new UserError(
      "The command contains a newline or another control character.",
      "It's typed into the container's shell, which would act on them as keys. Join lines with `;`.",
    );
  }
  const bytes = Buffer.byteLength(
    commandLine(argv, "0".repeat(NONCE_BYTES * 2)),
  );
  if (bytes > MAX_LINE_BYTES) {
    throw new UserError(
      `The command is too long (${bytes} of ${MAX_LINE_BYTES} bytes once typed).`,
      "It's typed into the container's shell, whose line limit would cut it off. Put longer scripts in a file in the image and run that.",
    );
  }
}

/** Pulls the command's output and exit code out of the terminal stream, which also carries the prompt and the echo. */
export class MarkedOutput {
  private readonly begin: string;
  private readonly end: string;
  started = false;
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
  /** Aborting sends Ctrl-C to the command, prints what arrives in the next moment, then closes the session. */
  signal?: AbortSignal;
  /** Overrides for tests. */
  connectTimeoutMs?: number;
  startTimeoutMs?: number;
  abortGraceMs?: number;
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
  const nonce = options.nonce ?? randomBytes(NONCE_BYTES).toString("hex");
  const output = new MarkedOutput(nonce);
  const decoder = new TextDecoder();

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    let opened = false;
    let settled = false;
    let aborted = false;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: number | UserError) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(startTimer);
      clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", onAbort);
      // Also abandons a socket still connecting, e.g. Ctrl-C before it opened, so it can't keep the process alive.
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "done");
      else if (socket.readyState === WebSocket.CONNECTING) socket.close();
      if (outcome instanceof UserError) reject(outcome);
      else resolve(outcome);
    };

    function onAbort() {
      if (socket.readyState !== WebSocket.OPEN) {
        finish(130);
        return;
      }
      aborted = true;
      clearTimeout(startTimer);
      socket.send("\x03");
      graceTimer = setTimeout(
        () => finish(130),
        options.abortGraceMs ?? ABORT_GRACE_MS,
      );
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const connectTimer = setTimeout(() => {
      finish(
        new UserError(
          "Timed out connecting to the exec session.",
          "Check your connection and try again.",
        ),
      );
      terminate(socket);
    }, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      // Settled while connecting: close the socket that opened anyway.
      if (settled) {
        socket.close(1000, "cancelled");
        return;
      }
      opened = true;
      clearTimeout(connectTimer);
      socket.send(token);
      if (options.size) {
        socket.send(JSON.stringify({ type: "resize", ...options.size }));
      }
      socket.send(new TextEncoder().encode(commandLine(argv, nonce)));
      startTimer = setTimeout(() => {
        if (output.started) return;
        finish(
          new UserError(
            "The container's shell didn't start the command.",
            "Run it again. If it keeps happening, the container may not have a POSIX shell with printf.",
          ),
        );
      }, options.startTimeoutMs ?? START_TIMEOUT_MS);
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
      if (output.exitCode !== undefined) {
        finish(aborted ? 130 : output.exitCode);
      }
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
      if (aborted) {
        finish(130);
        return;
      }
      // 1006 is also what exiting the shell gives, so a drop and a command that ran `exit` look the same.
      finish(
        new UserError(
          "The session ended before the command finished.",
          event.code === 1000 || event.code === 1006
            ? "The connection may have dropped, or the command exited the shell (wrap a bare `exit` in `sh -c '...'`). Run it again."
            : `Closed with ${event.code}${event.reason ? `: ${event.reason}` : ""}.`,
        ),
      );
    });
  });
}
