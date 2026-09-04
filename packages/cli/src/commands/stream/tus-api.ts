import { UserError } from "@/core/errors.ts";

/** Bunny's TUS endpoint. Not part of the OpenAPI spec, so it is pinned here. */
export const TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";

/** The only TUS protocol version bunny.net speaks. */
export const TUS_RESUMABLE = "1.0.0";

/** Chunk size for PATCH requests: big enough to be efficient, small enough to resume usefully. */
export const TUS_CHUNK_SIZE = 64 * 1024 * 1024;

/** How long the upload signature stays valid. Long enough for a very large file. */
export const TUS_EXPIRY_SECONDS = 6 * 60 * 60;

const MAX_CHUNK_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

/**
 * The upload's authorization signature.
 *
 * SHA-256 of `libraryId + apiKey + expirationTime + videoId`, hex encoded. The
 * expiration is part of the signed material, so it must be computed once and
 * sent unchanged in `AuthorizationExpire`.
 */
export function tusSignature(
  libraryId: number,
  apiKey: string,
  expires: number,
  videoId: string,
): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${libraryId}${apiKey}${expires}${videoId}`);
  return hasher.digest("hex");
}

/** Unix-second expiry for a signature created now. */
export function tusExpiration(
  now: number = Date.now(),
  windowSeconds: number = TUS_EXPIRY_SECONDS,
): number {
  return Math.floor(now / 1000) + windowSeconds;
}

/**
 * Encode an `Upload-Metadata` header value.
 *
 * TUS wants `key base64(value)` pairs, comma separated; empty entries are dropped
 * so an unknown filetype never sends a bare key.
 */
export function tusMetadata(
  entries: Record<string, string | undefined>,
): string {
  return Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${key} ${Buffer.from(value as string).toString("base64")}`,
    )
    .join(",");
}

export interface TusUploadOptions {
  libraryId: number;
  /** The library's own Stream API key: it is signed, never sent as a header. */
  apiKey: string;
  videoId: string;
  filePath: string;
  size: number;
  title: string;
  /** MIME type for the `filetype` metadata entry. */
  filetype?: string;
  endpoint?: string;
  chunkSize?: number;
  /** Precomputed expiry, mostly for tests; defaults to a fresh 6 hour window. */
  expires?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  onProgress?: (uploaded: number, total: number) => void;
  maxAttempts?: number;
  retryDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether a failed PATCH is worth retrying.
 *
 * A 409 is TUS's offset conflict, which resuming fixes; 5xx and transport errors
 * are transient. Other 4xx answers (bad or expired signature, deleted upload)
 * would fail identically on every attempt, so they stop immediately.
 */
function isRetryable(status: number): boolean {
  if (status === 409 || status === 423 || status === 429) return true;
  return status >= 500;
}

function offsetFrom(response: Response, fallback: number): number {
  const header = response.headers.get("Upload-Offset");
  const parsed = header === null ? Number.NaN : Number.parseInt(header, 10);
  // The server's offset is authoritative; only fall back when it says nothing.
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The presigned auth headers, which every TUS request needs.
 *
 * bunny.net authenticates each request in the upload individually, so the
 * creation POST, every PATCH, and every resume HEAD carry the same four
 * headers. Sending them only on creation gets the PATCHes rejected with a 401.
 */
export function tusAuthHeaders(
  opts: Pick<TusUploadOptions, "libraryId" | "apiKey" | "videoId">,
  expires: number,
): Record<string, string> {
  return {
    AuthorizationSignature: tusSignature(
      opts.libraryId,
      opts.apiKey,
      expires,
      opts.videoId,
    ),
    AuthorizationExpire: String(expires),
    VideoId: opts.videoId,
    LibraryId: String(opts.libraryId),
  };
}

/**
 * Create the TUS upload and return the URL to PATCH chunks to.
 *
 * The video entry must already exist: its GUID is what the signature covers.
 */
async function createTusUpload(
  opts: TusUploadOptions,
  fetchImpl: typeof fetch,
  auth: Record<string, string>,
): Promise<string> {
  const endpoint = opts.endpoint ?? TUS_ENDPOINT;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        ...auth,
        "Tus-Resumable": TUS_RESUMABLE,
        "Upload-Length": String(opts.size),
        "Upload-Metadata": tusMetadata({
          filetype: opts.filetype,
          title: opts.title,
        }),
      },
    });
  } catch (err) {
    throw new UserError(
      `Could not reach the resumable upload endpoint: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    throw new UserError(
      `The resumable upload was refused (HTTP ${response.status}).`,
      response.status === 401 || response.status === 403
        ? "The library's API key may not be allowed to upload, or the signature expired."
        : undefined,
    );
  }

  const location = response.headers.get("Location");
  if (!location) {
    throw new UserError(
      "The resumable upload was created without an upload URL.",
      "The server did not return a Location header.",
    );
  }
  // Bunny returns an absolute URL, but a relative one is legal in TUS.
  return new URL(location, endpoint).toString();
}

/** Ask the server how many bytes it actually holds, to resume from the truth. */
async function fetchTusOffset(
  url: string,
  fetchImpl: typeof fetch,
  fallback: number,
  auth: Record<string, string>,
): Promise<number> {
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      headers: { ...auth, "Tus-Resumable": TUS_RESUMABLE },
    });
    if (!response.ok) return fallback;
    return offsetFrom(response, fallback);
  } catch {
    // A failed HEAD leaves the last known offset as the best guess.
    return fallback;
  }
}

/**
 * Upload a file's bytes with the TUS resumable protocol.
 *
 * Chunks are PATCHed sequentially, and the server's `Upload-Offset` drives the
 * loop rather than a local counter, so a partially accepted chunk resumes from
 * exactly where the server stopped. Each chunk gets a few attempts, re-reading
 * the offset with HEAD in between; nothing is persisted across CLI runs, so an
 * interrupted command starts the upload again.
 */
export async function tusUpload(opts: TusUploadOptions): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const chunkSize = opts.chunkSize ?? TUS_CHUNK_SIZE;
  const maxAttempts = opts.maxAttempts ?? MAX_CHUNK_ATTEMPTS;
  const retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const expires = opts.expires ?? tusExpiration();
  // Signed once: the expiry is part of the signed material, and every request
  // in the upload presents the same signature.
  const auth = tusAuthHeaders(opts, expires);

  const uploadUrl = await createTusUpload(opts, fetchImpl, auth);
  const file = Bun.file(opts.filePath);

  let offset = 0;
  while (offset < opts.size) {
    let lastError: string | undefined;
    let uploaded = false;

    for (let attempt = 1; attempt <= maxAttempts && !uploaded; attempt++) {
      if (attempt > 1) {
        await delay(retryDelayMs);
        // Resume from the server's truth: it may hold part of the failed chunk.
        offset = await fetchTusOffset(uploadUrl, fetchImpl, offset, auth);
        if (offset >= opts.size) break;
      }

      // Recomputed per attempt: a resume can move the offset mid-chunk.
      const end = Math.min(offset + chunkSize, opts.size);
      const chunk = file.slice(offset, end);
      let response: Response;
      try {
        response = await fetchImpl(uploadUrl, {
          method: "PATCH",
          headers: {
            ...auth,
            "Tus-Resumable": TUS_RESUMABLE,
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: chunk,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (!isRetryable(response.status)) {
          throw new UserError(
            `The resumable upload failed at ${offset} of ${opts.size} bytes (${lastError}).`,
          );
        }
        continue;
      }

      const next = offsetFrom(response, end);
      // A server that does not advance would spin the loop forever.
      if (next <= offset) {
        lastError = `the server did not advance past ${offset} bytes`;
        continue;
      }
      offset = next;
      uploaded = true;
      opts.onProgress?.(offset, opts.size);
    }

    if (!uploaded && offset < opts.size) {
      throw new UserError(
        `The resumable upload stalled at ${offset} of ${opts.size} bytes after ${maxAttempts} attempts (${lastError ?? "unknown error"}).`,
        "Re-run the upload to start again.",
      );
    }
  }
}
