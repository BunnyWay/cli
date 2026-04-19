import type { ClientOptions } from "@bunny.net/api";
import type { ResolvedConfig } from "../config/index.ts";
import { UserError } from "./errors.ts";
import { logger } from "./logger.ts";
import { VERSION } from "./version.ts";

/** Build {@link ClientOptions} from a resolved CLI config. */
export function clientOptions(
  config: ResolvedConfig,
  verbose?: boolean,
): ClientOptions {
  if (!config.apiKey) {
    throw new UserError("Not logged in.", 'Run "bunny login" to authenticate.');
  }

  return {
    apiKey: config.apiKey,
    baseUrl: config.apiUrl,
    verbose,
    userAgent: `bunny-cli/${VERSION}`,
    onDebug: (msg) => logger.debug(msg, true),
  };
}
