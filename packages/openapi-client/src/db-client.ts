import createClient from "openapi-fetch";
import type { paths } from "./generated/database.d.ts";
import {
  authMiddleware,
  type ClientOptions,
  resolveBaseUrl,
} from "./middleware.ts";

const DB_BASE_URL = "https://api.bunny.net/database";

/** Create a type-safe client for the Bunny Database API. */
export function createDbClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: resolveBaseUrl(options, DB_BASE_URL, "/database"),
  });
  client.use(authMiddleware(options));
  return client;
}
