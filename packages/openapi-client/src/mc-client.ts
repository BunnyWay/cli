import createClient from "openapi-fetch";
import type { paths } from "./generated/magic-containers.d.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";

const MC_BASE_URL = "https://api.bunny.net/mc";

/** Create a type-safe client for the Bunny Magic Containers API. */
export function createMcClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? MC_BASE_URL,
  });
  client.use(authMiddleware(options));
  return client;
}
