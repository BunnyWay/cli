import type { Middleware } from "openapi-fetch";
import { ApiError } from "./errors.ts";

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  verbose?: boolean;
  /** User-Agent header value (e.g. "bunny-cli/0.1.0"). Defaults to "bunnynet-api". */
  userAgent?: string;
  /** Debug logger callback. Called with request/response details when verbose is true. */
  onDebug?: (msg: string) => void;
}

/**
 * Conservative content-type check - `application/json`,
 * `application/problem+json`, `application/vnd.api+json`, anything
 * with a `+json` suffix. Falls back to a substring match so
 * `application/json; charset=utf-8` still counts.
 */
function looksLikeJson(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return (
    lower.includes("application/json") ||
    lower.includes("+json") ||
    lower.includes("text/json")
  );
}

const STATUS_MESSAGES: Record<number, string> = {
  401: "Unauthorized. Check your API key.",
  403: "Forbidden. You don't have permission for this action.",
  404: "Not found.",
  409: "Conflict. The resource already exists or is in use.",
  500: "Internal server error.",
};

/**
 * Extract a normalized error from a parsed response body.
 * Each entry handles one API error format — first match wins.
 */
const extractors: Array<
  (
    body: any,
  ) => { message: string; field?: string; validationErrors?: any[] } | null
> = [
  // RFC 7807 ErrorDetails (Magic Containers)
  (b) =>
    b?.detail || b?.title
      ? { message: b.detail || b.title, validationErrors: b.errors }
      : null,

  // ApiErrorData (Core / Compute)
  (b) =>
    b?.Message ? { message: b.Message, field: b.Field ?? undefined } : null,
];

/**
 * Shared openapi-fetch middleware for all bunny.net API clients.
 *
 * **Request**: Injects `AccessKey` and `User-Agent` headers.
 *
 * **Response**: Intercepts non-OK responses and throws {@link ApiError},
 * normalizing the two different error formats used across bunny.net APIs:
 *
 * - **Core / Compute** use `ApiErrorData` (`{ ErrorKey, Field, Message }`).
 *   Only 400 responses have a JSON body; 401/404/500 are empty.
 * - **Magic Containers** use RFC 7807 (`{ title, status, detail, errors[] }`).
 *   All error status codes have a JSON body.
 *
 * Command handlers never need to check `response.ok` or parse error bodies —
 * a failed request throws before it reaches handler code.
 */
export function authMiddleware(options: ClientOptions): Middleware {
  const {
    apiKey,
    verbose = false,
    userAgent = "bunnynet-api",
    onDebug,
  } = options;
  const debug = verbose && onDebug ? onDebug : undefined;

  return {
    async onRequest({ request }) {
      request.headers.set("AccessKey", apiKey);
      request.headers.set("User-Agent", userAgent);

      if (debug) {
        debug(`→ ${request.method} ${request.url}`);
        if (request.body) {
          const cloned = request.clone();
          try {
            const body = await cloned.json();
            debug(`→ Body: ${JSON.stringify(body, null, 2)}`);
          } catch {}
        }
      }

      return request;
    },
    async onResponse({ response }) {
      if (debug) {
        const cloned = response.clone();
        debug(`← ${response.status} ${response.statusText}`);
        const contentType = response.headers.get("content-type") ?? "";
        if (looksLikeJson(contentType)) {
          try {
            const body = await cloned.json();
            debug(`← Body: ${JSON.stringify(body, null, 2)}`);
          } catch {}
        } else {
          // Non-JSON body - surface the raw text (truncated) so the
          // caller can see what arrived instead of getting nothing.
          try {
            const text = await cloned.text();
            const preview = text.length > 500 ? `${text.slice(0, 500)}…` : text;
            debug(`← Body (${contentType || "no content-type"}): ${preview}`);
          } catch {}
        }
      }

      // OK responses with a non-JSON body would otherwise crash
      // openapi-fetch when it tries to JSON.parse the bytes. Detect
      // that here and translate it into a clearer ApiError. This
      // commonly happens when a CDN / proxy / captive portal serves an
      // HTML error page with a 200 status code.
      if (response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (!looksLikeJson(contentType)) {
          const text = await response.clone().text();
          if (text.trim().length > 0) {
            const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
            throw new ApiError(
              `API returned a non-JSON ${response.status} response (content-type: ${contentType || "unset"}). ` +
                "This usually means an intermediate proxy or CDN is intercepting the request. " +
                `Body starts with: ${preview.replace(/\s+/g, " ").trim()}`,
              response.status,
            );
          }
        }
        return;
      }

      let body: any = null;
      try {
        body = await response.clone().json();
      } catch {
        // No JSON body (Core/Compute return empty bodies for 401/404/500)
      }

      const extracted =
        body &&
        extractors.reduce<ReturnType<(typeof extractors)[0]>>(
          (found, fn) => found ?? fn(body),
          null,
        );

      throw new ApiError(
        extracted?.message ??
          STATUS_MESSAGES[response.status] ??
          `API request failed (${response.status}).`,
        response.status,
        extracted?.field,
        extracted?.validationErrors,
      );
    },
  };
}
