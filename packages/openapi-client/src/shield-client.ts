import createClient from "openapi-fetch";
import type { paths } from "./generated/shield.d.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";
import { retryingFetch } from "./retry.ts";

const SHIELD_BASE_URL = "https://api.bunny.net";

/** Create a type-safe client for the Bunny Shield API (WAF, DDoS, rate limiting, bot detection). */
export function createShieldClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? SHIELD_BASE_URL,
    fetch: retryingFetch(options),
  });
  client.use(authMiddleware(options));
  return client;
}
