import { type Client, createClient } from "@libsql/client/web";
import pkg from "../package.json";

const USER_AGENT = `${pkg.name}/${pkg.version}`;

/**
 * Create a libSQL client with a custom `User-Agent` header
 * so requests from the CLI/shell can be identified server-side.
 */
export function createShellClient(opts: {
  url: string;
  authToken?: string;
}): Client {
  return createClient({
    ...opts,
    fetch: (input: string | Request | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (input instanceof Request) {
        input.headers.forEach((v, k) => {
          headers.set(k, v);
        });
      }
      headers.set("User-Agent", USER_AGENT);
      return fetch(input, { ...init, headers });
    },
  });
}
