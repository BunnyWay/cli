import { UserError } from "@/core/errors.ts";

/** Ctrl-]: closes the session from this side, for a remote that stops answering. Same key as telnet. */
export const DETACH_BYTE = 0x1d;

const CONNECT_TIMEOUT_MS = 15_000;
// How long a detach waits for the server to acknowledge the close before dropping the socket.
const CLOSE_GRACE_MS = 1_000;

// Signals that kill the process without firing "exit", so raw mode has to be undone by hand.
const FATAL_SIGNALS = { SIGTERM: 15, SIGHUP: 1 } as const;

/** The parts of `process.stdin` the session uses, so tests can pass plain streams. */
export interface TerminalInput {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
}

/** The parts of `process.stdout` the session uses. */
export interface TerminalOutput {
  write(data: string | Uint8Array): unknown;
  on(event: "resize", listener: () => void): unknown;
  off(event: "resize", listener: () => void): unknown;
  columns?: number;
  rows?: number;
}

export interface ExecSessionOptions {
  stdin?: TerminalInput;
  stdout?: TerminalOutput;
  /** Called once the socket is open, before any output, e.g. to print how to disconnect. */
  onOpen?: () => void;
  /** Overrides for tests. */
  connectTimeoutMs?: number;
  closeGraceMs?: number;
}

export interface ExecSessionEnd {
  code: number;
  reason: string;
  /** True when the user pressed Ctrl-] to leave. */
  detached: boolean;
}

// Bun's client WebSocket can drop the connection without a close handshake, but its types omit it.
function terminate(socket: WebSocket): void {
  (socket as WebSocket & { terminate?: () => void }).terminate?.();
}

/**
 * Bridge the local terminal to an exec WebSocket until either side closes it.
 *
 * Stdin goes out as binary frames, output comes back as binary or text
 * frames, and a JSON text frame `{"type":"resize","cols","rows"}` sets the
 * remote terminal size.
 */
export function runExecSession(
  url: string,
  options: ExecSessionOptions = {},
): Promise<ExecSessionEnd> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    let opened = false;
    let settled = false;
    let rawMode = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const sendResize = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!stdout.columns || !stdout.rows) return;
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: stdout.columns,
          rows: stdout.rows,
        }),
      );
    };

    // Raw mode survives the process otherwise, leaving the user's shell unusable.
    const restoreTerminal = () => {
      if (rawMode) stdin.setRawMode?.(false);
      rawMode = false;
    };

    const signalHandlers = Object.entries(FATAL_SIGNALS).map(
      ([signal, number]) =>
        [
          signal as NodeJS.Signals,
          () => {
            restoreTerminal();
            process.exit(128 + number);
          },
        ] as const,
    );

    const cleanup = () => {
      clearTimeout(connectTimer);
      restoreTerminal();
      stdin.off("data", onInput);
      stdin.pause();
      stdout.off("resize", sendResize);
      process.off("exit", restoreTerminal);
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
    };

    // Every way out goes through here, so the terminal is restored exactly once.
    const settle = (outcome: ExecSessionEnd | UserError) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (outcome instanceof UserError) reject(outcome);
      else resolve(outcome);
    };

    // Detach doesn't wait on the server: a remote that stopped answering may never acknowledge the close.
    const detach = () => {
      settle({ code: 1000, reason: "detached", detached: true });
      socket.close(1000, "detached");
      graceTimer = setTimeout(
        () => terminate(socket),
        options.closeGraceMs ?? CLOSE_GRACE_MS,
      );
    };

    function onInput(chunk: Buffer | string) {
      if (socket.readyState !== WebSocket.OPEN) return;
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const detachAt = bytes.indexOf(DETACH_BYTE);
      if (detachAt === -1) {
        socket.send(bytes);
        return;
      }
      if (detachAt > 0) socket.send(bytes.subarray(0, detachAt));
      detach();
    }

    const connectTimer = setTimeout(() => {
      settle(
        new UserError(
          "Timed out connecting to the exec session.",
          "Check your connection and try again.",
        ),
      );
      terminate(socket);
    }, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (settled) return;
      opened = true;
      clearTimeout(connectTimer);
      options.onOpen?.();
      // Raw mode sends every keystroke, Ctrl-C included, to the remote instead of this process.
      if (stdin.isTTY && stdin.setRawMode) {
        stdin.setRawMode(true);
        rawMode = true;
        process.once("exit", restoreTerminal);
        for (const [signal, handler] of signalHandlers) {
          process.once(signal, handler);
        }
      }
      stdin.on("data", onInput);
      stdin.resume();
      stdout.on("resize", sendResize);
      sendResize();
    });

    socket.addEventListener("message", (event) => {
      if (settled) return;
      const { data } = event;
      stdout.write(
        data instanceof ArrayBuffer ? new Uint8Array(data) : String(data),
      );
    });

    socket.addEventListener("close", (event) => {
      clearTimeout(graceTimer);
      if (!opened) {
        settle(
          new UserError(
            "Couldn't connect to the exec session.",
            event.reason || "The session may have expired; try again.",
          ),
        );
        return;
      }
      settle({ code: event.code, reason: event.reason, detached: false });
    });
  });
}
