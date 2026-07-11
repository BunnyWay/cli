import {
  Client,
  type ClientChannel,
  type ConnectConfig,
  type SFTPWrapper,
} from "ssh2";
import { CommandTimeoutError, SandboxError } from "./errors.ts";
import type { SandboxFileEntry } from "./types.ts";

export interface TransportConfig {
  host: string;
  port: number;
  /** Agent token used as the root password. */
  password: string;
  username?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ExecLimits {
  /** Kill the command and reject with CommandTimeoutError after this many milliseconds. */
  timeoutMs?: number;
  /** Abort to kill the command and reject with the signal's reason. */
  signal?: AbortSignal;
}

/** Minimal exec-channel surface, kept narrow so tests can fake it. */
export interface ExecStreamLike {
  on(event: string, cb: (...args: never[]) => void): unknown;
  stderr: { on(event: string, cb: (data: Buffer) => void): unknown };
  signal(name: string): void;
  close(): void;
}

/** Collect an exec channel to completion, enforcing the given limits. */
export function collectExec(
  stream: ExecStreamLike,
  limits: ExecLimits = {},
): Promise<ExecResult> {
  let stdout = "";
  let stderr = "";
  stream.on("data", (d: Buffer) => {
    stdout += d.toString();
  });
  stream.stderr.on("data", (d: Buffer) => {
    stderr += d.toString();
  });

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      limits.signal?.removeEventListener("abort", onAbort);
    };
    const kill = () => {
      try {
        stream.signal("KILL");
      } catch {}
      try {
        stream.close();
      } catch {}
    };
    const onAbort = () => {
      cleanup();
      kill();
      reject(limits.signal?.reason);
    };
    stream.on("error", (err: Error) => {
      cleanup();
      reject(err);
    });
    stream.on("close", (code: number | null) => {
      cleanup();
      resolve({ stdout, stderr, exitCode: code ?? null });
    });
    if (limits.signal?.aborted) return onAbort();
    limits.signal?.addEventListener("abort", onAbort, { once: true });
    if (limits.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        cleanup();
        kill();
        reject(new CommandTimeoutError(limits.timeoutMs ?? 0, stdout, stderr));
      }, limits.timeoutMs);
    }
  });
}

/** SFTP attrs surface used to build a SandboxFileEntry. */
export interface FileAttrsLike {
  size?: number;
  mode: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isFile(): boolean;
}

/** Map SFTP attrs onto a SandboxFileEntry. */
export function fileEntryFromAttrs(
  name: string,
  attrs: FileAttrsLike,
): SandboxFileEntry {
  const type = attrs.isDirectory()
    ? "directory"
    : attrs.isSymbolicLink()
      ? "symlink"
      : attrs.isFile()
        ? "file"
        : "other";
  return { name, type, size: attrs.size ?? 0, mode: attrs.mode & 0o7777 };
}

// ssh2 reports a missing SFTP file as the numeric status NO_SUCH_FILE (2), not a Node ENOENT string.
const SFTP_NO_SUCH_FILE = 2;
function isMissingFileError(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  return (
    code === "ENOENT" || code === "NO_SUCH_FILE" || code === SFTP_NO_SUCH_FILE
  );
}

/** Pure-JS SSH/SFTP transport over a single reused connection. */
export class SshTransport {
  private conn: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private sftpChannel: Promise<SFTPWrapper> | null = null;

  constructor(private readonly config: TransportConfig) {}

  /** Connect, retrying until the SSH server accepts connections or timeout. */
  async waitUntilReachable(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      try {
        await this.ready();
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw new SandboxError("Sandbox SSH did not become reachable.", lastErr);
  }

  /** Run a command to completion and collect its output. */
  async exec(command: string, limits?: ExecLimits): Promise<ExecResult> {
    return collectExec(await this.execStream(command), limits);
  }

  /** Start a command and return its live channel for streaming. */
  async execStream(command: string): Promise<ClientChannel> {
    const conn = await this.ready();
    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) reject(new SandboxError("Command failed to start.", err));
        else resolve(stream);
      });
    });
  }

  async writeFile(path: string, content: Buffer, mode?: number): Promise<void> {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.writeFile(path, content, mode ? { mode } : {}, (err) => {
        if (err) reject(new SandboxError(`Failed to write ${path}.`, err));
        else resolve();
      });
    });
  }

  /** Read a file into a Buffer, or null when it does not exist. */
  async readFile(path: string): Promise<Buffer | null> {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.readFile(path, (err, data) => {
        if (!err) return resolve(data);
        if (isMissingFileError(err)) return resolve(null);
        reject(new SandboxError(`Failed to read ${path}.`, err));
      });
    });
  }

  /** List a directory's entries, sorted by name. Resolves to [] when the directory does not exist. */
  async readDir(path: string): Promise<SandboxFileEntry[]> {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (err, list) => {
        if (err && isMissingFileError(err)) return resolve([]);
        if (err)
          return reject(new SandboxError(`Failed to list ${path}.`, err));
        resolve(
          list
            .map((e) => fileEntryFromAttrs(e.filename, e.attrs))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      });
    });
  }

  /** Delete a file. Returns false when it does not exist. */
  async unlink(path: string): Promise<boolean> {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.unlink(path, (err) => {
        if (!err) return resolve(true);
        if (isMissingFileError(err)) return resolve(false);
        reject(new SandboxError(`Failed to delete ${path}.`, err));
      });
    });
  }

  /** Rename or move a file or directory. Fails when the destination exists. */
  async rename(from: string, to: string): Promise<void> {
    // OpenSSH's SFTP rename overwrites silently, so guard here (small TOCTOU window accepted).
    if ((await this.stat(to)) !== null) {
      throw new SandboxError(`Failed to rename ${from}: ${to} already exists.`);
    }
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.rename(from, to, (err) => {
        if (err) {
          reject(new SandboxError(`Failed to rename ${from} to ${to}.`, err));
        } else resolve();
      });
    });
  }

  /** Stat a path into a SandboxFileEntry, or null when it does not exist. */
  async stat(path: string): Promise<SandboxFileEntry | null> {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.stat(path, (err, attrs) => {
        if (!err) {
          return resolve(
            fileEntryFromAttrs(path.split("/").pop() || path, attrs),
          );
        }
        if (isMissingFileError(err)) return resolve(null);
        reject(new SandboxError(`Failed to stat ${path}.`, err));
      });
    });
  }

  close(): void {
    this.conn?.end();
    this.conn = null;
    this.connecting = null;
    this.sftpChannel = null;
  }

  /** Open the SFTP subsystem once and reuse the channel across operations. */
  private sftp(): Promise<SFTPWrapper> {
    if (this.sftpChannel) return this.sftpChannel;
    this.sftpChannel = this.ready().then(
      (conn) =>
        new Promise<SFTPWrapper>((resolve, reject) => {
          conn.sftp((err, sftp) => {
            if (err) {
              this.sftpChannel = null;
              reject(new SandboxError("Failed to open SFTP.", err));
              return;
            }
            sftp.on("close", () => {
              this.sftpChannel = null;
            });
            resolve(sftp);
          });
        }),
    );
    return this.sftpChannel;
  }

  private ready(): Promise<Client> {
    if (this.conn) return Promise.resolve(this.conn);
    if (this.connecting) return this.connecting;

    const config: ConnectConfig = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username ?? "root",
      password: this.config.password,
      readyTimeout: 15_000,
    };

    this.connecting = new Promise<Client>((resolve, reject) => {
      const conn = new Client();
      conn
        .on("ready", () => {
          this.conn = conn;
          this.connecting = null;
          resolve(conn);
        })
        .on("error", (err) => {
          this.connecting = null;
          reject(new SandboxError("SSH connection failed.", err));
        })
        .on("close", () => {
          this.conn = null;
          this.sftpChannel = null;
        })
        .connect(config);
    });
    return this.connecting;
  }
}
