import createClient from "openapi-fetch";
import type { paths } from "./generated/database.d.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";
import { retryingFetch } from "./retry.ts";

const DB_BASE_URL = "https://api.bunny.net/database";

/** Create a type-safe client for the Bunny Database API. */
export function createDbClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? DB_BASE_URL,
    fetch: retryingFetch(options),
  });
  client.use(authMiddleware(options));
  return client;
}
