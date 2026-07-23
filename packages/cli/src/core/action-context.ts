import { type ActionContext, createActionContext } from "@bunny.net/actions";
import type { ResolvedConfig } from "../config/index.ts";
import { clientOptions } from "./client-options.ts";
import { logger } from "./logger.ts";
import { VERSION } from "./version.ts";

export interface ActionContextOpts {
  verbose?: boolean;
  signal?: AbortSignal;
  /** Where an action's progress messages go, e.g. a spinner's text. */
  onProgress?: (message: string) => void;
}

/**
 * Build an {@link ActionContext} from a resolved CLI config.
 *
 * The API key is resolved through {@link clientOptions} on first client use, so
 * commands backed by actions that call no API still run unauthenticated, and
 * everything else fails with the usual "Not logged in." message.
 */
export function actionContext(
  config: ResolvedConfig,
  opts: ActionContextOpts = {},
): ActionContext {
  return createActionContext({
    apiKey: () => clientOptions(config, opts.verbose).apiKey,
    apiUrl: config.apiUrl,
    userAgent: `bunny-cli/${VERSION}`,
    signal: opts.signal,
    onProgress: opts.onProgress,
    onDebug: opts.verbose ? (msg) => logger.debug(msg, true) : undefined,
  });
}
