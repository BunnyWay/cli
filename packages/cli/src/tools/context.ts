import {
  type ClientOptions,
  createCoreClient,
  createDbClient,
  createMcClient,
  createStreamClient,
  UserError,
} from "@bunny.net/openapi-client";
import {
  createRegistryClient,
  type RegistryClient,
} from "./registry/client.ts";

export type CoreClient = ReturnType<typeof createCoreClient>;
export type DbClient = ReturnType<typeof createDbClient>;
export type McClient = ReturnType<typeof createMcClient>;
export type StreamClient = ReturnType<typeof createStreamClient>;

/** API clients a tool may reach for. Created on first access, then reused. */
export interface ToolClients {
  readonly core: CoreClient;
  readonly db: DbClient;
  readonly mc: McClient;
  /** The OCI registry. Not generated from a spec, so it is hand-rolled in `registry/client.ts`. */
  readonly registry: RegistryClient;
  /** A Stream client for one video library: its own host, authenticated with that library's key instead of the account key. */
  streamLibrary(apiKey: string): StreamClient;
}

export interface ToolContextOptions {
  /** API key, or a function returning one. Read on first client use, so credential-free tools run unauthenticated. */
  apiKey?: string | (() => string);
  apiUrl?: string;
  /** Identifies the caller in request logs, e.g. `bunny-cli/0.16.1`. */
  userAgent?: string;
  /** Override the OCI registry endpoint. Defaults to `registry.bunny.net`. */
  registryUrl?: string;
  signal?: AbortSignal;
  /** Coarse status updates, shown as the spinner text. */
  onProgress?: (message: string) => void;
  onDebug?: (message: string) => void;
  /** Pre-built clients, for tests. */
  clients?: Partial<ToolClients>;
  /** Where tools read third-party source credentials. Defaults to empty, never the live `process.env`. */
  env?: ToolEnv;
  /** Let source adapters fall back to ambient credentials (AWS profiles, SSO, instance roles). */
  allowAmbientCredentials?: boolean;
}

export type ToolEnv = Readonly<Record<string, string | undefined>>;

/** Credentials, clients, cancellation, and progress; deliberately no way to prompt or print. */
export interface ToolContext {
  readonly clients: ToolClients;
  readonly signal?: AbortSignal;
  /** Third-party credentials are read from here so they never travel in tool input. */
  readonly env: ToolEnv;
  /** Identifies the host to third-party APIs a tool calls, e.g. a video source. */
  readonly userAgent: string;
  readonly allowAmbientCredentials: boolean;
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
    get registry() {
      return lazy("registry", (opts) =>
        createRegistryClient({
          apiKey: opts.apiKey,
          url: options.registryUrl,
        }),
      );
    },
    streamLibrary(apiKey) {
      const injected = options.clients?.streamLibrary;
      if (injected) return injected(apiKey);
      return createStreamClient({
        apiKey,
        verbose: Boolean(options.onDebug),
        userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
        onDebug: options.onDebug,
      });
    },
  };

  return {
    clients,
    signal: options.signal,
    env: options.env ?? {},
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    allowAmbientCredentials: options.allowAmbientCredentials ?? false,
    progress: (message) => options.onProgress?.(message),
    debug: (message) => options.onDebug?.(message),
  };
}

export interface ToolContextOverrides {
  /** Layered over the context's env for this invocation only, e.g. credentials just prompted for. */
  env?: ToolEnv;
  onProgress?: (message: string) => void;
}

/** A context sharing `ctx`'s clients, with an env overlay or a different progress sink. */
export function extendToolContext(
  ctx: ToolContext,
  overrides: ToolContextOverrides,
): ToolContext {
  return {
    ...ctx,
    env: overrides.env ? { ...ctx.env, ...overrides.env } : ctx.env,
    progress: overrides.onProgress ?? ctx.progress,
  };
}
