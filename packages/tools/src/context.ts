import {
  type ClientOptions,
  createCoreClient,
  createDbClient,
  createMcClient,
  UserError,
} from "@bunny.net/openapi-client";

export type CoreClient = ReturnType<typeof createCoreClient>;
export type DbClient = ReturnType<typeof createDbClient>;
export type McClient = ReturnType<typeof createMcClient>;

/** API clients a tool may reach for. Created on first access, then reused. */
export interface ToolClients {
  readonly core: CoreClient;
  readonly db: DbClient;
  readonly mc: McClient;
}

export interface ToolContextOptions {
  /** API key, or a function returning one. Read on first client use, so credential-free tools run unauthenticated. */
  apiKey?: string | (() => string);
  /** Override the API base URL (staging or self-hosted endpoints). */
  apiUrl?: string;
  /** Identifies the caller in request logs, e.g. `bunny-cli/0.16.1`. */
  userAgent?: string;
  signal?: AbortSignal;
  /** Coarse "what am I doing now" updates. The host renders them (spinner, log line, progress event). */
  onProgress?: (message: string) => void;
  /** Request/response tracing from the API clients. */
  onDebug?: (message: string) => void;
  /** Pre-built clients, for tests and hosts that construct their own. */
  clients?: Partial<ToolClients>;
}

/**
 * Everything a tool needs from its host: credentials, clients, cancellation,
 * and progress reporting. Deliberately has no prompt or print capability;
 * asking the user and rendering output are the host's job.
 */
export interface ToolContext {
  readonly clients: ToolClients;
  readonly signal?: AbortSignal;
  progress(message: string): void;
  debug(message: string): void;
}

const DEFAULT_USER_AGENT = "bunnynet-tools";

export function createToolContext(
  options: ToolContextOptions = {},
): ToolContext {
  const cache = new Map<keyof ToolClients, unknown>();

  const clientOptions = (): ClientOptions => {
    const apiKey =
      typeof options.apiKey === "function" ? options.apiKey() : options.apiKey;
    if (!apiKey) {
      throw new UserError(
        "No bunny.net API key available.",
        "Pass `apiKey` when creating the tool context, or set BUNNYNET_API_KEY.",
      );
    }
    return {
      apiKey,
      baseUrl: options.apiUrl,
      verbose: Boolean(options.onDebug),
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
      onDebug: options.onDebug,
    };
  };

  function lazy<K extends keyof ToolClients>(
    key: K,
    create: (opts: ClientOptions) => ToolClients[K],
  ): ToolClients[K] {
    const injected = options.clients?.[key];
    if (injected) return injected;
    if (!cache.has(key)) cache.set(key, create(clientOptions()));
    return cache.get(key) as ToolClients[K];
  }

  const clients: ToolClients = {
    get core() {
      return lazy("core", createCoreClient);
    },
    get db() {
      return lazy("db", createDbClient);
    },
    get mc() {
      return lazy("mc", createMcClient);
    },
  };

  return {
    clients,
    signal: options.signal,
    progress: (message) => options.onProgress?.(message),
    debug: (message) => options.onDebug?.(message),
  };
}
