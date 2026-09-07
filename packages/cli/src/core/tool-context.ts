import { createToolContext, type ToolContext } from "@bunny.net/tools";
import type { ResolvedConfig } from "@/config/index.ts";
import { clientOptions } from "./client-options.ts";
import { logger } from "./logger.ts";
import { VERSION } from "./version.ts";

export interface ToolContextOpts {
  verbose?: boolean;
  signal?: AbortSignal;
  /** Where a tool's progress messages go, e.g. a spinner's text. */
  onProgress?: (message: string) => void;
}

/**
 * Build a {@link ToolContext} from a resolved CLI config.
 *
 * The API key is resolved through {@link clientOptions} on first client use, so
 * commands backed by tools that call no API still run unauthenticated, and
 * everything else fails with the usual "Not logged in." message.
 */
export function toolContext(
  config: ResolvedConfig,
  opts: ToolContextOpts = {},
): ToolContext {
  return createToolContext({
    apiKey: () => clientOptions(config, opts.verbose).apiKey,
    apiUrl: config.apiUrl,
    userAgent: `bunny-cli/${VERSION}`,
    signal: opts.signal,
    onProgress: opts.onProgress,
    onDebug: opts.verbose ? (msg) => logger.debug(msg, true) : undefined,
  });
}
