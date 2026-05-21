import createClient from "openapi-fetch";
import type { paths } from "./generated/origin-errors.d.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";

const ORIGIN_ERRORS_BASE_URL = "https://cdn-origin-logging.bunny.net";

/** Create a type-safe client for the Bunny Origin Errors API (CDN origin error logs). */
export function createOriginErrorsClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? ORIGIN_ERRORS_BASE_URL,
  });
  client.use(authMiddleware(options));
  return client;
}
