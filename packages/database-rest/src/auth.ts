// Shared-token auth wrapper. The shape (options bag, optional callbacks,
// exported option type) is intentionally designed so future variants can
// be added without breaking existing callers:
//   - A verifier-based variant (Clerk, Auth0, JWT, etc.) lands by widening
//     RequireAuthOptions to a union; today's TokenAuthOptions stays valid.
//   - Session context can flow into the handler via an optional second arg.
//   - isPublic can grow optional arguments (e.g. the full Request) without
//     breaking pathname-only callers.
//   - Response customisation lands as new optional fields (e.g. onUnauthorized).
// Keep these surfaces open when editing.

import { timingSafeEqual } from "node:crypto";

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

const extractCookie = (req: Request, name: string): string | null => {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
};

const unauthorized = (): Response =>
  new Response(JSON.stringify({ message: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Bearer realm="database-rest"',
    },
  });

export interface RequireAuthOptions {
  /** Shared secret the request must present. */
  token: string;
  /** If set, also accept the token from this cookie. */
  cookieName?: string;
  /** Optional predicate: pathnames for which auth is skipped. */
  isPublic?: (pathname: string) => boolean;
}

/**
 * Wrap a request handler with a shared-token check.
 *
 * Accepts the token via `Authorization: Bearer <token>` and, optionally,
 * via a named cookie. Comparison is timing-safe. Returns 401 with
 * `WWW-Authenticate: Bearer realm="database-rest"` on failure.
 *
 * @example Basic bearer
 * ```ts
 * import { createRestHandler, requireAuth } from "@bunny.net/database-rest";
 *
 * const handler = createRestHandler(executor, schema);
 * const guarded = requireAuth(handler, { token: process.env.API_TOKEN! });
 *
 * Bun.serve({ port: 8080, hostname: "127.0.0.1", fetch: guarded });
 * ```
 *
 * @example Cookie + bearer with a public handshake route
 * ```ts
 * const guarded = requireAuth(handler, {
 *   token: sessionToken,
 *   cookieName: "session",
 *   isPublic: (p) => p === "/auth",
 * });
 * ```
 *
 * @remarks
 * `requireAuth` covers the shared-token case. For richer auth (Clerk,
 * Auth0, JWT verification, per-row scopes), wrap `createRestHandler`'s
 * result yourself; it returns a standard Web `Request` → `Response`
 * handler, so any check that fits in a `fetch` wrapper works:
 *
 * ```ts
 * Bun.serve({
 *   fetch: async (req) => {
 *     const session = await myAuthProvider.authenticate(req);
 *     if (!session) return new Response("Unauthorized", { status: 401 });
 *     return handler(req);
 *   },
 * });
 * ```
 *
 * The API is shaped so a verifier-based variant
 * (`{ verify: (req) => session | null }`) can land later as an additive
 * widening of {@link RequireAuthOptions}, without breaking existing
 * `{ token }` callers.
 */
export const requireAuth = (
  handler: (req: Request) => Response | Promise<Response>,
  options: RequireAuthOptions,
): ((req: Request) => Promise<Response>) => {
  return async (req: Request): Promise<Response> => {
    if (options.isPublic) {
      const { pathname } = new URL(req.url);
      if (options.isPublic(pathname)) return handler(req);
    }

    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const spaceIndex = authHeader.indexOf(" ");
      if (spaceIndex > 0) {
        const scheme = authHeader.slice(0, spaceIndex);
        const presented = authHeader.slice(spaceIndex + 1).trim();
        if (
          scheme.toLowerCase() === "bearer" &&
          presented &&
          safeEqual(presented, options.token)
        ) {
          return handler(req);
        }
      }
    }

    if (options.cookieName) {
      const cookie = extractCookie(req, options.cookieName);
      if (cookie && safeEqual(cookie, options.token)) {
        return handler(req);
      }
    }

    return unauthorized();
  };
};
