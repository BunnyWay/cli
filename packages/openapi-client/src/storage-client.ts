import createClient from "openapi-fetch";
import type { paths } from "./generated/storage.d.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";

const STORAGE_BASE_URL = "https://storage.bunnycdn.com";

/**
 * Create a type-safe client for the Bunny Edge Storage API.
 *
 * The Storage API is region-specific. Pass `baseUrl` to target a non-default
 * region (e.g. `https://la.storage.bunnycdn.com`, `https://ny.storage.bunnycdn.com`).
 * The `apiKey` should be a Storage Zone password (read-only or read-write).
 */
export function createStorageClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? STORAGE_BASE_URL,
  });
  client.use(authMiddleware(options));
  return client;
}
