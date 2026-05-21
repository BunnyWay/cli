import createClient from "openapi-fetch";
import type { paths } from "./generated/stream.d.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";

const STREAM_BASE_URL = "https://video.bunnycdn.com";

/**
 * Create a type-safe client for the Bunny Stream API (video libraries, collections, videos).
 *
 * The `apiKey` should be a Stream Library API key (per-library), not the account-wide key.
 */
export function createStreamClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? STREAM_BASE_URL,
  });
  client.use(authMiddleware(options));
  return client;
}
