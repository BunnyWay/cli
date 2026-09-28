export interface SandboxAuth {
  /** bunny.net API key. Falls back to BUNNYNET_API_KEY when omitted. */
  apiKey?: string;
  /** Override the Magic Containers API base URL. */
  apiUrl?: string;
  /** Emit request/response debug lines to onDebug. */
  verbose?: boolean;
  /** Debug logger callback, used when verbose is true. */
  onDebug?: (msg: string) => void;
}

export interface CreateOptions extends SandboxAuth {
  /** Unique app name. A random name is generated when omitted. */
  name?: string;
  /** Region ID to deploy in (e.g. AMS, NY, LA). Defaults to AMS. */
  region?: string;
  /** Container ports to expose as public CDN endpoints at creation time. */
  ports?: number[];
  /** Default environment variables for the container. */
  env?: Record<string, string>;
  /** Persistent volume size in GB. Defaults to 10. */
  volumeSize?: number;
  /** Override the container image. Defaults to the bunny sandbox-agent image. */
  image?: SandboxImage;
  /** Cancel provisioning. */
  signal?: AbortSignal;
}

export interface GetOptions extends SandboxAuth {
  appId: string;
}

export interface SandboxImage {
  registryId: string;
  namespace: string;
  name: string;
  tag: string;
  /** Pinned sha256 digest. Lets MC skip its flaky create-time registry lookup. */
  digest?: string;
}

/** Serializable handle that round-trips a sandbox across processes. */
export interface SandboxHandle {
  appId: string;
  name: string;
  agentToken: string;
  sshHost: string;
  /** Exposed port to public host mappings discovered so far. */
  ports?: Record<number, string>;
}

interface RunCommandOptionsBase {
  cmd: string;
  args?: string[];
  /** Working directory. Defaults to the sandbox workplace. */
  cwd?: string;
  /** Extra environment variables for this command only. */
  env?: Record<string, string>;
  sudo?: boolean;
}

/** Options for a blocking command (the default). */
export interface BlockingCommandOptions extends RunCommandOptionsBase {
  detached?: false;
  /** Kill the command and reject with CommandTimeoutError after this many milliseconds. */
  timeout?: number;
  /** Abort to kill the command and reject with the signal's reason. */
  signal?: AbortSignal;
  /** Called with stdout chunks as they arrive. */
  onStdout?: (chunk: string) => void;
  /** Called with stderr chunks as they arrive. */
  onStderr?: (chunk: string) => void;
}

/**
 * Options for a detached command, which returns a live Command immediately.
 * A detached command manages its own lifetime — use `command.kill()` and
 * `command.logs()` instead of `timeout`/`signal`/output callbacks.
 */
export interface DetachedCommandOptions extends RunCommandOptionsBase {
  detached: true;
}

export type RunCommandOptions = BlockingCommandOptions | DetachedCommandOptions;

/** A directory entry returned by listFiles. */
export interface SandboxFileEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  /** Size in bytes. */
  size: number;
  /** Unix permission bits. */
  mode: number;
}

export interface FileToWrite {
  /** Path inside the sandbox. Relative paths resolve against the workplace. */
  path: string;
  content: Buffer | string;
  /** Unix file mode in octal, e.g. 0o755 for an executable. */
  mode?: number;
}
