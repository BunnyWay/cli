import { createStreamClient } from "@bunny.net/openapi-client";
import type { ResolvedConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { UserError } from "@/core/errors.ts";
import type { VideoLibraryModel } from "./api.ts";

export type StreamClient = ReturnType<typeof createStreamClient>;

/** A video length in seconds as `m:ss`, or `h:mm:ss` once it reaches an hour. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const total = Math.round(seconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

/** The library's own Stream API key. */
function libraryApiKey(library: VideoLibraryModel): string {
  if (!library.ApiKey) {
    throw new UserError(
      `No API key available for video library ${library.Name ?? library.Id}.`,
      "Video operations need the library's own Stream API key; check that the account key can read it.",
    );
  }
  return library.ApiKey;
}

/**
 * Build a Stream API client for one video library.
 *
 * The video-level API lives on its own host and authenticates with the
 * library's own key, so the account key and the core API base URL from the
 * CLI config are both dropped here.
 */
export function connectStreamLibrary(
  library: VideoLibraryModel,
  opts: { config: ResolvedConfig; verbose?: boolean },
): StreamClient {
  const apiKey = libraryApiKey(library);

  // baseUrl is the core API host: leaving it in would point the Stream client at api.bunny.net.
  const { baseUrl: _core, ...options } = clientOptions(
    opts.config,
    opts.verbose,
  );
  return createStreamClient({ ...options, apiKey });
}
