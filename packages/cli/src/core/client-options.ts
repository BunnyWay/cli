import type { ClientOptions } from "@bunny.net/api";
import type { ResolvedConfig } from "../config/index.ts";
import { VERSION } from "./version.ts";
import { logger } from "./logger.ts";

/** Build {@link ClientOptions} from a resolved CLI config. */
export function clientOptions(config: ResolvedConfig, verbose?: boolean): ClientOptions {
  return {
    apiKey: config.apiKey,
    baseUrl: config.apiUrl,
    verbose,
    userAgent: `bunny-cli/${VERSION}`,
    onDebug: (msg) => logger.debug(msg, true),
  };
}
