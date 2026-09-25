/**
 * openapi-fetch middleware that retries 429s from the Stream API using the
 * server's `Retry-After`.
 *
 * openapi-fetch runs `onResponse` in reverse registration order, so this has to
 * be registered after `authMiddleware` to see the 429 before auth turns it into
 * a thrown `ApiError`.
 *
 * `onRequest` stashes an unconsumed clone of the request: by the time
 * `onResponse` runs, the original request's body has been read by `fetch`, so a
 * POST could not otherwise be replayed. It also applies the per-request
 * deadline, so the stashed clone carries only the caller's signal and a replay
 * gets a fresh deadline while still honouring the caller's cancellation.
 */

import { ApiError } from "@bunny.net/openapi-client";
import type { Middleware } from "openapi-fetch";
import type { Logger } from "./contracts.ts";

/** Cap a hostile `Retry-After` so a bad header cannot park the process for hours. */
const MAX_RETRY_AFTER_SECONDS = 300;
const DEFAULT_RETRY_AFTER_SECONDS = 30;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RateLimitOptions {
  maxRetries: number;
  logger: Logger;
  /** Deadline for each attempt, applied here so a replay gets a fresh one. */
  requestTimeout: number;
  /** Injected by tests so they do not actually wait. */
  wait?: (ms: number) => Promise<void>;
}

export function createRateLimitMiddleware({
  maxRetries,
  logger,
  requestTimeout,
  wait = sleep,
}: RateLimitOptions): Middleware {
  // Typed loosely: openapi-fetch declares its Request from undici types, which Bun's global fetch signature rejects.
  const replayable = new Map<string, Request>();

  return {
    onRequest({ request, id }) {
      const original = request as unknown as Request;
      replayable.set(id, original.clone() as unknown as Request);

      return withDeadline(
        original,
        requestTimeout,
      ) as unknown as typeof request;
    },

    async onResponse({ request, response, id }) {
      if (response.status !== 429) {
        replayable.delete(id);

        return undefined;
      }

      const template = replayable.get(id) ?? (request as unknown as Request);
      let current = response;
      // The budget is a local, so every paginated request gets its own.
      let attempt = 0;

      while (current.status === 429 && attempt < maxRetries) {
        attempt++;
        const header = Number.parseInt(
          current.headers.get("retry-after") ?? "",
          10,
        );
        const retryAfter = Math.min(
          Math.max(
            Number.isNaN(header) ? DEFAULT_RETRY_AFTER_SECONDS : header,
            1,
          ),
          MAX_RETRY_AFTER_SECONDS,
        );

        logger.warn(
          `Bunny rate limit hit. Waiting ${retryAfter}s (attempt ${attempt}/${maxRetries})...`,
        );
        await wait(retryAfter * 1000);

        template.signal.throwIfAborted();
        // Clone per attempt so `template` stays replayable.
        current = await fetch(
          withDeadline(
            template.clone() as unknown as Request,
            requestTimeout,
          ) as Parameters<typeof fetch>[0],
        );
      }

      replayable.delete(id);

      if (current.status === 429) {
        throw new ApiError(
          `Bunny API rate limit exceeded after ${maxRetries} retries.`,
          429,
        );
      }

      return current;
    },

    onError({ id }) {
      replayable.delete(id);

      return undefined;
    },
  };
}

/** The request bounded by `ms` on top of whatever signal the caller gave it. */
function withDeadline(request: Request, ms: number): Request {
  return new Request(request, {
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(ms)]),
  });
}
