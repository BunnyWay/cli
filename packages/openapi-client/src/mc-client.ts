import createClient from "openapi-fetch";
import type { paths } from "./generated/magic-containers.d.ts";
import {
  authMiddleware,
  type ClientOptions,
  resolveBaseUrl,
} from "./middleware.ts";

const MC_BASE_URL = "https://api.bunny.net/mc";

/** Create a type-safe client for the Magic Containers API. */
export function createMcClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: resolveBaseUrl(options, MC_BASE_URL, "/mc"),
  });
  client.use(authMiddleware(options));
  return client;
}
