import createClient from "openapi-fetch";
import type { paths } from "./generated/compute.d.ts";
import {
  authMiddleware,
  type ClientOptions,
  resolveBaseUrl,
} from "./middleware.ts";

const COMPUTE_BASE_URL = "https://api.bunny.net";

/** Create a type-safe client for the Edge Scripting (Compute) API. */
export function createComputeClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: resolveBaseUrl(options, COMPUTE_BASE_URL),
  });
  client.use(authMiddleware(options));
  return client;
}
