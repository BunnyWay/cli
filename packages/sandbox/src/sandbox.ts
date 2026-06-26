import { randomBytes } from "node:crypto";
import type { createMcClient } from "@bunny.net/openapi-client";
import { Command, CommandFinished } from "./command.ts";
import { SandboxError } from "./errors.ts";
import {
  addCdnEndpoint,
  createApp,
  deleteApp,
  extractAgentToken,
  extractAnycastHost,
  firstContainerId,
  getApp,
  mcClient,
  splitHost,
  WORKPLACE,
  waitForPublicHost,
  waitForSshHost,
} from "./provision.ts";
import { SshTransport } from "./transport.ts";
import type {
  CreateOptions,
  FileToWrite,
  GetOptions,
  RunCommandOptions,
  SandboxAuth,
  SandboxHandle,
} from "./types.ts";

type McClient = ReturnType<typeof createMcClient>;

const DEFAULT_REGION = "AMS";
const DEFAULT_VOLUME_GB = 10;
const SSH_REACHABLE_TIMEOUT_MS = 120_000;
const DEFAULT_IMAGE = {
  registryId: "1156",
  namespace: "bunnyway",
  name: "sandbox-agent",
  tag: "latest",
} as const;

/** Programmatic handle to a bunny.net sandbox backed by a Magic Containers app. */
export class Sandbox {
  readonly appId: string;
  readonly name: string;
  private readonly agentToken: string;
  private readonly sshHost: string;
  private readonly ports: Map<number, string>;
  private readonly client: McClient;
  private readonly transport: SshTransport;

  private constructor(
    handle: SandboxHandle,
    client: McClient,
    transport: SshTransport,
  ) {
    this.appId = handle.appId;
    this.name = handle.name;
    this.agentToken = handle.agentToken;
    this.sshHost = handle.sshHost;
    this.ports = new Map(
      Object.entries(handle.ports ?? {}).map(([p, h]) => [Number(p), h]),
    );
    this.client = client;
    this.transport = transport;
  }

  /** Provision a new sandbox and wait until it accepts connections. */
  static async create(options: CreateOptions = {}): Promise<Sandbox> {
    const client = mcClient(options);
    const name = options.name ?? generateName();
    const agentToken = generateToken();

    const appId = await createApp(client, {
      name,
      region: options.region ?? DEFAULT_REGION,
      agentToken,
      volumeSize: options.volumeSize ?? DEFAULT_VOLUME_GB,
      env: options.env ?? {},
      image: options.image ?? DEFAULT_IMAGE,
    });

    let sshHost: string;
    try {
      sshHost = await waitForSshHost(client, appId, options.signal);
    } catch (err) {
      await deleteApp(client, appId).catch(() => {});
      throw err;
    }

    const transport = transportFor(sshHost, agentToken);
    try {
      await transport.waitUntilReachable(SSH_REACHABLE_TIMEOUT_MS);
    } catch (err) {
      await deleteApp(client, appId).catch(() => {});
      throw err;
    }

    const sandbox = new Sandbox(
      { appId, name, agentToken, sshHost },
      client,
      transport,
    );

    try {
      for (const port of options.ports ?? []) {
        await sandbox.exposePort(port);
      }
    } catch (err) {
      await deleteApp(client, appId).catch(() => {});
      throw err;
    }
    return sandbox;
  }

  /** Retrieve an existing sandbox by app ID, recovering its connection details. */
  static async get(options: GetOptions): Promise<Sandbox> {
    const client = mcClient(options);
    const app = await getApp(client, options.appId);

    const agentToken = extractAgentToken(app);
    const sshHost = extractAnycastHost(app);
    if (!agentToken || !sshHost) {
      throw new SandboxError(
        "Could not recover sandbox credentials from the app.",
      );
    }
    const name = (app as { name?: string }).name ?? options.appId;

    return new Sandbox(
      { appId: options.appId, name, agentToken, sshHost },
      client,
      transportFor(sshHost, agentToken),
    );
  }

  /** Rebuild a sandbox from a serialized handle without an API round trip. */
  static fromHandle(handle: SandboxHandle, auth: SandboxAuth = {}): Sandbox {
    return new Sandbox(
      handle,
      mcClient(auth),
      transportFor(handle.sshHost, handle.agentToken),
    );
  }

  /** Run a command, blocking for the result unless detached is set. */
  async runCommand(command: string, args?: string[]): Promise<CommandFinished>;
  async runCommand(command: RunCommandOptions): Promise<Command>;
  async runCommand(
    command: string | RunCommandOptions,
    args: string[] = [],
  ): Promise<CommandFinished | Command> {
    const opts: RunCommandOptions =
      typeof command === "string" ? { cmd: command, args } : command;
    const remote = buildRemoteCommand(opts);

    if (opts.detached) {
      return new Command(await this.transport.execStream(remote));
    }
    const { stdout, stderr, exitCode } = await this.transport.exec(remote);
    return new CommandFinished(exitCode, stdout, stderr);
  }

  /** Upload one or more files, creating parent directories as needed. */
  async writeFiles(files: FileToWrite[]): Promise<void> {
    for (const file of files) {
      const path = resolvePath(file.path);
      const dir = path.slice(0, path.lastIndexOf("/"));
      if (dir) await this.mkDir(dir);
      const content =
        typeof file.content === "string"
          ? Buffer.from(file.content)
          : file.content;
      await this.transport.writeFile(path, content, file.mode);
    }
  }

  /** Read a file into a Buffer, or null when it does not exist. */
  async readFile(path: string): Promise<Buffer | null> {
    return this.transport.readFile(resolvePath(path));
  }

  async mkDir(path: string): Promise<void> {
    const { exitCode, stderr } = await this.transport.exec(
      `mkdir -p ${shellQuote(resolvePath(path))}`,
    );
    if (exitCode !== 0) {
      throw new SandboxError(`Failed to create directory: ${stderr.trim()}`);
    }
  }

  /** Expose a container port as a public CDN endpoint and return its URL. */
  async exposePort(port: number, label?: string): Promise<string> {
    const app = await getApp(this.client, this.appId);
    const containerId = firstContainerId(app);
    if (!containerId) {
      throw new SandboxError("Could not find a container to expose the port.");
    }
    const endpointId = await addCdnEndpoint(
      this.client,
      this.appId,
      containerId,
      port,
      label,
    );
    const host = await waitForPublicHost(this.client, this.appId, endpointId);
    this.ports.set(port, host);
    return `https://${host}`;
  }

  /** Return the public URL for a previously exposed port. */
  domain(port: number): string {
    const host = this.ports.get(port);
    if (!host) {
      throw new SandboxError(
        `Port ${port} is not exposed. Call exposePort(${port}) first.`,
      );
    }
    return `https://${host}`;
  }

  /** Permanently delete the sandbox and its backing app. */
  async delete(): Promise<void> {
    this.transport.close();
    await deleteApp(this.client, this.appId);
  }

  /** Close the SSH connection without deleting the sandbox. */
  disconnect(): void {
    this.transport.close();
  }

  /** Serialize the sandbox so another process can reconnect via fromHandle. */
  toHandle(): SandboxHandle {
    return {
      appId: this.appId,
      name: this.name,
      agentToken: this.agentToken,
      sshHost: this.sshHost,
      ports: Object.fromEntries(this.ports),
    };
  }
}

function transportFor(sshHost: string, password: string): SshTransport {
  const { host, port } = splitHost(sshHost);
  return new SshTransport({ host, port, password });
}

const ENV_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function buildRemoteCommand(opts: RunCommandOptions): string {
  const parts: string[] = [`cd ${shellQuote(opts.cwd ?? WORKPLACE)} &&`];
  if (opts.sudo) parts.push("sudo");
  for (const [key, value] of Object.entries(opts.env ?? {})) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new SandboxError(`Invalid environment variable name: ${key}`);
    }
    parts.push(`${key}=${shellQuote(value)}`);
  }
  parts.push(shellQuote(opts.cmd));
  for (const arg of opts.args ?? []) parts.push(shellQuote(arg));
  return parts.join(" ");
}

/** Resolve a sandbox path, defaulting relative paths to the workplace. */
export function resolvePath(path: string): string {
  return path.startsWith("/") ? path : `${WORKPLACE}/${path}`;
}

/** Single-quote a token for safe use in a remote shell command. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function generateName(): string {
  return `sandbox-${randomBytes(4).toString("hex")}`;
}
