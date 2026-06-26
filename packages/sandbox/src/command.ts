import type { ClientChannel } from "ssh2";
import { SandboxError } from "./errors.ts";

export interface LogChunk {
  stream: "stdout" | "stderr";
  data: string;
}

export class CommandFinished {
  constructor(
    readonly exitCode: number | null,
    private readonly _stdout: string,
    private readonly _stderr: string,
  ) {}

  async stdout(): Promise<string> {
    return this._stdout;
  }

  async stderr(): Promise<string> {
    return this._stderr;
  }
}

/** A live command. Stream output via logs() and await wait() for the result. */
export class Command {
  exitCode: number | null = null;
  private _stdout = "";
  private _stderr = "";
  private closed = false;
  private readonly done: Promise<CommandFinished>;
  private readonly queue: LogChunk[] = [];
  private readonly waiters: Array<(r: IteratorResult<LogChunk>) => void> = [];

  constructor(private readonly stream: ClientChannel) {
    stream.on("data", (d: Buffer) => this.push("stdout", d.toString()));
    stream.stderr.on("data", (d: Buffer) => this.push("stderr", d.toString()));
    this.done = new Promise((resolve, reject) => {
      stream.on("close", (code: number | null) => {
        this.exitCode = code ?? null;
        this.closed = true;
        for (const w of this.waiters.splice(0)) {
          w({ done: true, value: undefined });
        }
        resolve(new CommandFinished(this.exitCode, this._stdout, this._stderr));
      });
      stream.on("error", (err: Error) => {
        this.closed = true;
        for (const w of this.waiters.splice(0)) {
          w({ done: true, value: undefined });
        }
        reject(new SandboxError("Command stream error.", err));
      });
    });
    // Keep an unawaited stream error from surfacing as an unhandled rejection.
    this.done.catch(() => {});
  }

  /** Async-iterate stdout and stderr chunks as they arrive. */
  logs(): AsyncIterableIterator<LogChunk> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next(): Promise<IteratorResult<LogChunk>> {
        const buffered = self.queue.shift();
        if (buffered) return Promise.resolve({ done: false, value: buffered });
        if (self.closed)
          return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => self.waiters.push(resolve));
      },
    };
  }

  async wait(): Promise<CommandFinished> {
    return this.done;
  }

  /** Collect the full stdout after the command exits. */
  async stdout(): Promise<string> {
    await this.done;
    return this._stdout;
  }

  /** Collect the full stderr after the command exits. */
  async stderr(): Promise<string> {
    await this.done;
    return this._stderr;
  }

  /** Send a signal to the running process. Defaults to TERM. */
  kill(signal = "TERM"): void {
    this.stream.signal(signal);
  }

  private push(stream: "stdout" | "stderr", data: string): void {
    if (stream === "stdout") this._stdout += data;
    else this._stderr += data;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value: { stream, data } });
    else this.queue.push({ stream, data });
  }
}
