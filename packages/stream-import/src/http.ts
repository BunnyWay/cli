/**
 * The small fetch wrapper every source client is built on: base URL, default
 * headers, basic auth, a per-request timeout, and a 429 back-off that honours
 * `Retry-After`. Non-2xx responses throw `HttpError` so callers branch on
 * status instead of parsing messages.
 */

import { UserError } from "@bunny.net/openapi-client";
import { MAX_RATE_LIMIT_RETRIES } from "./constants.ts";
import { trimTrailingSlashes } from "./sanitize.ts";

/** Cap a hostile `Retry-After` so a bad header cannot park the process for hours. */
const MAX_RETRY_AFTER_SECONDS = 300;
const DEFAULT_RETRY_AFTER_SECONDS = 30;

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function isHttpError(
  error: unknown,
  status?: number,
): error is HttpError {
  return (
    error instanceof HttpError &&
    (status === undefined || error.status === status)
  );
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface HttpOptions {
  /** Service name for error messages, e.g. "Vimeo". */
  label: string;
  baseUrl: string;
  headers?: Record<string, string>;
  auth?: { username: string; password: string };
  /** Per-request deadline in milliseconds. */
  timeout: number;
  userAgent: string;
  /** Called before each rate-limit back-off with a human-readable line. */
  onRetry?: (message: string) => void;
  /** Injected by tests so a back-off does not really wait. */
  wait?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  params?: Query;
  headers?: Record<string, string>;
}

export interface Http {
  get<T = any>(path: string, opts?: RequestOptions): Promise<T>;
  post<T = any>(
    path: string,
    body?: unknown,
    opts?: RequestOptions & { contentType?: string },
  ): Promise<T>;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildUrl(baseUrl: string, path: string, params?: Query): URL {
  const url = /^https?:\/\//i.test(path)
    ? new URL(path)
    : new URL(
        `${trimTrailingSlashes(baseUrl)}${path && !path.startsWith("/") ? "/" : ""}${path}`,
      );
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  return url;
}

function retryAfterSeconds(response: Response): number {
  const header = Number.parseInt(response.headers.get("retry-after") ?? "", 10);

  return Math.min(
    Math.max(Number.isNaN(header) ? DEFAULT_RETRY_AFTER_SECONDS : header, 1),
    MAX_RETRY_AFTER_SECONDS,
  );
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;

  return name === "TimeoutError" || name === "AbortError";
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (/json/i.test(contentType)) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();

  return text === "" ? null : text;
}

export function createHttp(options: HttpOptions): Http {
  const wait = options.wait ?? sleep;
  const baseHeaders: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": options.userAgent,
    ...options.headers,
  };
  if (options.auth) {
    baseHeaders.Authorization = `Basic ${btoa(`${options.auth.username}:${options.auth.password}`)}`;
  }

  async function request<T>(
    method: string,
    path: string,
    init: RequestOptions & { body?: string },
  ): Promise<T> {
    const url = buildUrl(options.baseUrl, path, init.params);

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: { ...baseHeaders, ...init.headers },
          body: init.body,
          signal: AbortSignal.timeout(options.timeout),
        });
      } catch (error) {
        if (isTimeout(error)) {
          throw new UserError(
            `${options.label} request timed out after ${Math.round(options.timeout / 1000)} seconds.`,
            "Raise the limit with --request-timeout.",
          );
        }
        throw error;
      }

      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const seconds = retryAfterSeconds(response);
        options.onRetry?.(
          `${options.label} rate limit hit. Waiting ${seconds}s (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})...`,
        );
        await wait(seconds * 1000);
        continue;
      }

      const body = await parseBody(response);
      if (response.status === 429) {
        throw new UserError(
          `${options.label} rate limit exceeded after ${MAX_RATE_LIMIT_RETRIES} retries.`,
        );
      }
      if (!response.ok) {
        throw new HttpError(
          `${options.label} request failed (${response.status}).`,
          response.status,
          body,
        );
      }

      return body as T;
    }
  }

  return {
    get: (path, opts = {}) => request("GET", path, opts),
    post: (path, body, opts = {}) => {
      const { contentType, ...rest } = opts;
      if (body === undefined) return request("POST", path, rest);
      const isRaw = typeof body === "string";

      return request("POST", path, {
        ...rest,
        headers: {
          "Content-Type":
            contentType ??
            (isRaw ? "application/x-www-form-urlencoded" : "application/json"),
          ...rest.headers,
        },
        body: isRaw ? body : JSON.stringify(body),
      });
    },
  };
}
