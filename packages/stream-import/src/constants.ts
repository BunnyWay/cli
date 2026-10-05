export const DEFAULT_REQUEST_TIMEOUT = 30_000;
export const DEFAULT_PROCESSING_TIMEOUT = 3_600_000;
export const DEFAULT_MIGRATION_TIMEOUT = 5_400_000;
export const DEFAULT_CONCURRENCY = 3;

export const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 21_600;
export const MAX_PRESIGNED_URL_TTL_SECONDS = 604_800;
export const MIN_PRESIGNED_URL_TTL_SECONDS = 3_600;

export const MAX_RATE_LIMIT_RETRIES = 5;

/** Bunny Stream rejects sources longer than this. */
export const MAX_VIDEO_DURATION_SECONDS = 72 * 3_600;
/** Bunny Stream's resolution ceiling, 2160p: 3840x2160 landscape or 2160x3840 portrait. */
export const MAX_VIDEO_LONG_EDGE = 3_840;
export const MAX_VIDEO_SHORT_EDGE = 2_160;

/** A resume stops retrying a video after this many fetches; a fresh run or `cleanFailed` tries it again. */
export const MAX_IMPORT_ATTEMPTS = 3;

export const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".flv",
  ".wmv",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".3gp",
  ".ogv",
  // `.ts` is deliberately absent: an HLS bucket holds thousands of segments with that extension.
  ".m2ts",
  ".vod",
  ".amv",
];
