import createClient from "openapi-fetch";
import type { paths } from "./generated/core.d.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";

/**
 * Undocumented endpoints not present in the generated OpenAPI spec.
 * Intersected with `paths` so the typed client can call them.
 */
type CustomPaths = {
  "/user": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              Email: string;
              FirstName: string;
              LastName: string;
              Roles: string[];
            };
          };
        };
      };
    };
  };
};

const CORE_BASE_URL = "https://api.bunny.net";

/** Create a type-safe client for the Bunny Core API (CDN, DNS, storage zones, billing). */
export function createCoreClient(options: ClientOptions) {
  const client = createClient<paths & CustomPaths>({ baseUrl: options.baseUrl ?? CORE_BASE_URL });
  client.use(authMiddleware(options));
  return client;
}
