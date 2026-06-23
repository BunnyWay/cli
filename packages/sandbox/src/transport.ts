import {
  Client,
  type ClientChannel,
  type ConnectConfig,
  type SFTPWrapper,
} from "ssh2";
import { SandboxError } from "./errors.ts";

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

/** Pure-JS SSH/SFTP transport over a single reused connection. */
export class SshTransport {
  private conn: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private readonly config: TransportConfig) {}

  /** Connect, retrying until the SSH server accepts connections or timeout. */
  async waitUntilReachable(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
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
  async exec(command: string): Promise<ExecResult> {
    const stream = await this.execStream(command);
    let stdout = "";
    let stderr = "";
    stream.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    stream.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    return new Promise((resolve, reject) => {
      stream.on("error", reject);
      stream.on("close", (code: number | null) => {
        resolve({ stdout, stderr, exitCode: code });
      });
    });
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
        if ((err as NodeJS.ErrnoException).code === "ENOENT")
          return resolve(null);
        reject(new SandboxError(`Failed to read ${path}.`, err));
      });
    });
  }

  close(): void {
    this.conn?.end();
    this.conn = null;
    this.connecting = null;
  }

  private async sftp(): Promise<SFTPWrapper> {
    const conn = await this.ready();
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) reject(new SandboxError("Failed to open SFTP.", err));
        else resolve(sftp);
      });
    });
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
        })
        .connect(config);
    });
    return this.connecting;
  }
}
