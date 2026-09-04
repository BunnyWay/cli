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

/**
 * Property names whose string values are secrets: API keys, zone passwords,
 * tokens, and any Authorization-style header.
 */
const SECRET_KEY_RE = /^(.*key|.*password|.*secret|.*token|authorization.*)$/i;

const REDACTED = "[redacted]";

/**
 * Copy a parsed body with every secret-looking string value replaced.
 *
 * Verbose mode dumps request and response bodies, and those bodies carry real
 * credentials: a video library answers with its ApiKey, a storage zone with its
 * password, and a Stream fetch request with the origin's Authorization header.
 * Redacting is structural (by property name) so it holds for shapes this code
 * has never seen.
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  // Deeply nested or cyclic bodies are not worth walking; bail to a marker.
  if (depth > 8) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry, depth + 1));
  }
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && SECRET_KEY_RE.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    // A `headers` map holds its secrets one level down, keyed by header name.
    if (
      /^headers$/i.test(key) &&
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry)
    ) {
      const headers: Record<string, unknown> = {};
      for (const [name, headerValue] of Object.entries(
        entry as Record<string, unknown>,
      )) {
        headers[name] =
          typeof headerValue === "string" && SECRET_KEY_RE.test(name)
            ? REDACTED
            : redactSecrets(headerValue, depth + 1);
      }
      out[key] = headers;
      continue;
    }
    out[key] = redactSecrets(entry, depth + 1);
  }
  return out;
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

  // StatusModel (Stream): { success, message, statusCode } — lowercase, so the
  // Core extractor above misses it and the message would be lost.
  (b) =>
    typeof b?.message === "string" && b.message ? { message: b.message } : null,
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
          const contentType = request.headers.get("content-type") ?? "";
          if (looksLikeJson(contentType)) {
            const cloned = request.clone();
            try {
              const body = await cloned.json();
              debug(`→ Body: ${JSON.stringify(redactSecrets(body), null, 2)}`);
            } catch {}
          } else {
            // Never read a non-JSON request body: a binary upload (e.g. a video
            // sent as application/octet-stream) would be buffered into memory in
            // full just to be logged. Describe it from the headers instead.
            const length = request.headers.get("content-length");
            debug(
              `→ Body (${contentType || "no content-type"}): ${
                length ? `${length} bytes, not logged` : "not logged"
              }`,
            );
          }
        }
      }

      return request;
    },
    async onResponse({ response, options }) {
      if (debug) {
        const cloned = response.clone();
        debug(`← ${response.status} ${response.statusText}`);
        const contentType = response.headers.get("content-type") ?? "";
        if (looksLikeJson(contentType)) {
          try {
            const body = await cloned.json();
            debug(`← Body: ${JSON.stringify(redactSecrets(body), null, 2)}`);
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

      // openapi-fetch only JSON.parses the body when parseAs is "json" (its
      // default). Callers that fetch downloads opt out via parseAs: "text"
      // (etc.), so a non-JSON body is expected there and passes through. A
      // non-JSON body on a JSON call is almost always a CDN / proxy / captive
      // portal serving an HTML error page with a 200 status — surface that as
      // a clear ApiError instead of letting openapi-fetch crash on JSON.parse.
      if (response.ok) {
        const parseAs = options?.parseAs ?? "json";
        const contentType = response.headers.get("content-type") ?? "";
        if (parseAs === "json" && !looksLikeJson(contentType)) {
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
