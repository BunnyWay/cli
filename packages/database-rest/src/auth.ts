// Shared-token auth wrapper. The shape (options bag, optional callbacks,
// exported option type) is intentionally designed so future variants can
// be added without breaking existing callers:
//   - The verifier-based variant (Clerk, Auth0, JWT, etc.) widened
//     RequireAuthOptions to a union; TokenAuthOptions stays valid.
//   - Session context flows into the handler as an optional second arg.
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

export interface TokenAuthOptions {
  /** Shared secret the request must present. */
  token: string;
  /** If set, also accept the token from this cookie. */
  cookieName?: string;
  /** Optional predicate: pathnames for which auth is skipped. */
  isPublic?: (pathname: string) => boolean;
}

export interface VerifyAuthOptions<Session> {
  /**
   * Resolves the request to a session, or `null`/`undefined` when it carries
   * no valid credentials (answered with 401). Use it for JWTs, Clerk, Auth0,
   * or your own sessions. A verifier that throws rejects the returned promise
   * rather than letting the request through.
   */
  verify: (
    req: Request,
  ) => Session | null | undefined | Promise<Session | null | undefined>;
  /** Optional predicate: pathnames for which auth is skipped. */
  isPublic?: (pathname: string) => boolean;
}

export type RequireAuthOptions<Session = unknown> =
  | TokenAuthOptions
  | VerifyAuthOptions<Session>;

type Handler = (req: Request) => Response | Promise<Response>;

/** On a public path there is no session, so the handler gets `null`. */
type SessionHandler<Session> = (
  req: Request,
  session: Session | null,
) => Response | Promise<Response>;

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
 * For anything beyond a shared token, pass `verify` instead. The session
 * it returns is handed to the handler as a second argument:
 *
 * ```ts
 * const guarded = requireAuth(
 *   (req, session) => handler(req),
 *   { verify: async (req) => verifyJwt(req.headers.get("authorization")) },
 * );
 * ```
 */
export function requireAuth(
  handler: Handler,
  options: TokenAuthOptions,
): (req: Request) => Promise<Response>;
export function requireAuth<Session>(
  handler: SessionHandler<Session>,
  options: VerifyAuthOptions<Session>,
): (req: Request) => Promise<Response>;
export function requireAuth<Session>(
  handler: SessionHandler<Session>,
  options: RequireAuthOptions<Session>,
): (req: Request) => Promise<Response>;
export function requireAuth<Session>(
  handler: SessionHandler<Session>,
  options: RequireAuthOptions<Session>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (options.isPublic) {
      const { pathname } = new URL(req.url);
      if (options.isPublic(pathname)) return handler(req, null);
    }

    if ("verify" in options) {
      const session = await options.verify(req);
      if (session === null || session === undefined) return unauthorized();

      return handler(req, session);
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
          return handler(req, null);
        }
      }
    }

    if (options.cookieName) {
      const cookie = extractCookie(req, options.cookieName);
      if (cookie && safeEqual(cookie, options.token)) {
        return handler(req, null);
      }
    }

    return unauthorized();
  };
}
