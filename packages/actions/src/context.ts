import {
  type ClientOptions,
  createCoreClient,
  createDbClient,
  UserError,
} from "@bunny.net/openapi-client";

export type CoreClient = ReturnType<typeof createCoreClient>;
export type DbClient = ReturnType<typeof createDbClient>;

/** API clients an action may reach for. Created on first access, then reused. */
export interface ActionClients {
  readonly core: CoreClient;
  readonly db: DbClient;
}

export interface ActionContextOptions {
  /**
   * bunny.net API key, or a function returning one. Required unless every client
   * used is supplied via {@link ActionContextOptions.clients}. Read on first
   * client use, so actions that call no API stay usable unauthenticated.
   */
  apiKey?: string | (() => string);
  /** Override the API base URL (self-hosted or staging endpoints). */
  apiUrl?: string;
  /** Identifies the caller in request logs, e.g. `bunny-cli/0.10.1` or `bunny-mcp/0.1.0`. */
  userAgent?: string;
  signal?: AbortSignal;
  /** Coarse "what am I doing now" updates. The host renders them (spinner, log line, MCP notification). */
  onProgress?: (message: string) => void;
  /** Request/response tracing from the API clients. */
  onDebug?: (message: string) => void;
  /** Pre-built clients, for tests and hosts that construct their own. */
  clients?: Partial<ActionClients>;
}

/**
 * Everything an action needs from its host: credentials, clients, cancellation,
 * and progress reporting. Deliberately has no prompt or print capability -
 * asking the user and rendering output are the host's job.
 */
export interface ActionContext {
  readonly clients: ActionClients;
  readonly signal?: AbortSignal;
  progress(message: string): void;
  debug(message: string): void;
}

const DEFAULT_USER_AGENT = "bunnynet-actions";

export function createActionContext(
  options: ActionContextOptions = {},
): ActionContext {
  const cache = new Map<keyof ActionClients, unknown>();

  const clientOptions = (): ClientOptions => {
    const apiKey =
      typeof options.apiKey === "function" ? options.apiKey() : options.apiKey;
    if (!apiKey) {
      throw new UserError(
        "No bunny.net API key available.",
        "Pass `apiKey` when creating the action context, or set BUNNYNET_API_KEY.",
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

  function lazy<K extends keyof ActionClients>(
    key: K,
    create: (opts: ClientOptions) => ActionClients[K],
  ): ActionClients[K] {
    const injected = options.clients?.[key];
    if (injected) return injected;
    if (!cache.has(key)) cache.set(key, create(clientOptions()));
    return cache.get(key) as ActionClients[K];
  }

  const clients: ActionClients = {
    get core() {
      return lazy("core", createCoreClient);
    },
    get db() {
      return lazy("db", createDbClient);
    },
  };

  return {
    clients,
    signal: options.signal,
    progress: (message) => options.onProgress?.(message),
    debug: (message) => options.onDebug?.(message),
  };
}
