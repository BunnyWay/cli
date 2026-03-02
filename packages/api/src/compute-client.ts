import createClient from "openapi-fetch";
import type { paths } from "./generated/compute.d.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";

const COMPUTE_BASE_URL = "https://api.bunny.net";

/** Create a type-safe client for the Bunny Edge Scripting (Compute) API. */
export function createComputeClient(options: ClientOptions) {
  const client = createClient<paths>({ baseUrl: options.baseUrl ?? COMPUTE_BASE_URL });
  client.use(authMiddleware(options));
  return client;
}
