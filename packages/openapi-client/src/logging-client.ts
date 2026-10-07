import createClient from "openapi-fetch";
import type { paths } from "./logging-types.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";

const LOGGING_BASE_URL = "https://logging.bunnycdn.com";

/** Create a type-safe client for the Bunny CDN Logging API (pull zone request logs). */
export function createLoggingClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? LOGGING_BASE_URL,
  });
  client.use(authMiddleware(options));
  return client;
}
