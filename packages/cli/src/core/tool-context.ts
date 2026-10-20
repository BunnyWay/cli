import type { ResolvedConfig } from "@/config/index.ts";
import { createToolContext, type ToolContext } from "@/tools/index.ts";
import { registryUrl } from "./bunny-registry.ts";
import { clientOptions } from "./client-options.ts";
import { logger } from "./logger.ts";
import { aboveSpinners } from "./ui.ts";
import { VERSION } from "./version.ts";

export interface ToolContextOpts {
  verbose?: boolean;
  signal?: AbortSignal;
  /** Where a tool's progress messages go, e.g. a spinner's text. */
  onProgress?: (message: string) => void;
}

/** The API key resolves on first client use, so tools that call no API run unauthenticated. */
export function toolContext(
  config: ResolvedConfig,
  opts: ToolContextOpts = {},
): ToolContext {
  return createToolContext({
    apiKey: () => clientOptions(config, opts.verbose).apiKey,
    apiUrl: config.apiUrl,
    registryUrl: registryUrl(),
    userAgent: `bunny-cli/${VERSION}`,
    signal: opts.signal,
    // The CLI acts as the local user, so their environment and AWS profile are legitimate credential sources.
    env: process.env,
    allowAmbientCredentials: true,
    onProgress: opts.onProgress,
    onDebug: opts.verbose
      ? (msg) => aboveSpinners(() => logger.debug(msg, true))
      : undefined,
  });
}
