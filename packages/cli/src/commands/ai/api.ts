import { errorMessage, UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { VERSION } from "@/core/version.ts";

export const URL_ENV = "BUNNYNET_AI_URL";
export const KEY_ENV = "BUNNYNET_AI_API_KEY";
export const MODEL_ENV = "BUNNYNET_AI_MODEL";

export const DEFAULT_MODEL = "openai/gpt-4o-mini";

interface ErrorBody {
  error?: string | { message?: string };
  message?: string;
}

function endpoint(): { url: string; key: string } {
  // Paths carry their own /v1, so a base URL copied with one still works.
  const url = process.env[URL_ENV]?.replace(/\/+$/, "").replace(/\/v1$/, "");
  const key = process.env[KEY_ENV];
  const missing = [!url && URL_ENV, !key && KEY_ENV].filter(Boolean);
  if (!url || !key) {
    throw new UserError(
      `Missing ${missing.join(" and ")}.`,
      `Set ${URL_ENV} and ${KEY_ENV} in your environment or a .env file.`,
    );
  }
  return { url, key };
}

const INVALID_REQUEST = "The request was invalid.";

function hintFor(res: Response, message: string): string | undefined {
  if (res.status === 401) return `Check ${KEY_ENV}.`;
  if (res.status === 404) return `Check ${URL_ENV}.`;
  // An unknown model and a disallowed one both answer with the generic invalid-request body.
  if (message === INVALID_REQUEST || /\bmodel\b/.test(message)) {
    return 'Run "bunny ai models" to see the models your key can use.';
  }
  if (res.status === 429) {
    // Retry-After is a number of seconds or an HTTP date.
    const retryAfter = res.headers.get("retry-after");
    if (!retryAfter) return "Retry shortly.";
    return /^\d+$/.test(retryAfter)
      ? `Retry after ${retryAfter}s.`
      : `Retry after ${retryAfter}.`;
  }
  if (res.status >= 500) {
    const id = res.headers.get("x-request-id");
    return id ? `Retry shortly. Request id: ${id}` : "Retry shortly.";
  }
  return undefined;
}

/** Turn a network failure or timeout into a `UserError`; anything else is rethrown. */
export function toNetworkError(err: unknown): unknown {
  if (err instanceof UserError) return err;
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") {
    return new UserError(
      "The request timed out.",
      "Raise the limit with --timeout <seconds>.",
    );
  }
  if (name === "TypeError" || name === "AbortError" || name === "Error") {
    return new UserError(
      `Could not reach the service: ${errorMessage(err)}`,
      `Check ${URL_ENV}.`,
    );
  }
  return err;
}

async function toError(res: Response): Promise<UserError> {
  const text = await res.text();
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const body = JSON.parse(text) as ErrorBody;
    const error =
      typeof body.error === "string" ? body.error : body.error?.message;
    // Some errors pair a short `error` with a longer `message`.
    const detail = body.message && body.message !== error ? body.message : "";
    if (error) message = detail ? `${error}: ${detail}` : error;
  } catch {}
  return new UserError(message, hintFor(res, message));
}

/** Send an authenticated request and throw a `UserError` for any non-2xx answer. */
export async function aiFetch(
  path: string,
  verbose: boolean,
  body?: unknown,
  timeoutSeconds = 120,
): Promise<Response> {
  const { url, key } = endpoint();
  const method = body === undefined ? "GET" : "POST";
  logger.debug(`→ ${method} ${url}${path}`, verbose);

  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "User-Agent": `bunny-cli/${VERSION}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  }).catch((err) => {
    throw toNetworkError(err);
  });

  logger.debug(
    `← ${res.status} ${res.statusText} (request ${res.headers.get("x-request-id") ?? "unknown"})`,
    verbose,
  );
  if (!res.ok) throw await toError(res);
  return res;
}

function parseFrame<T>(line: string): T | "done" | undefined {
  if (!line.startsWith("data:")) return undefined;
  const data = line.slice(5).trim();
  if (!data) return undefined;
  if (data === "[DONE]") return "done";
  try {
    return JSON.parse(data) as T;
  } catch {
    throw new UserError("The service sent a malformed response.");
  }
}

/** Yield the JSON payload of each `data:` frame; throws if the stream ends before `[DONE]`. */
export async function* sseFrames<T>(res: Response): AsyncGenerator<T> {
  if (!res.body) throw new UserError("The service sent an empty response.");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const frame = parseFrame<T>(line);
        if (frame === "done") return;
        if (frame !== undefined) yield frame;
      }
    }
  } catch (err) {
    throw toNetworkError(err);
  }
  const frame = parseFrame<T>(buffer);
  if (frame === "done") return;
  if (frame !== undefined) yield frame;
  // A failure after the 200 cannot change the status, so it shows up only as a stream cut short.
  throw new UserError(
    "The response ended before it was complete.",
    "Nothing after this point was received. Retry the request.",
  );
}
