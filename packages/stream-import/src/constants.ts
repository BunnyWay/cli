export const DEFAULT_REQUEST_TIMEOUT = 30_000;
export const DEFAULT_PROCESSING_TIMEOUT = 3_600_000;
export const DEFAULT_MIGRATION_TIMEOUT = 5_400_000;
export const DEFAULT_CONCURRENCY = 3;

export const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 21_600;
export const MAX_PRESIGNED_URL_TTL_SECONDS = 604_800;
export const MIN_PRESIGNED_URL_TTL_SECONDS = 60;

export const MAX_RATE_LIMIT_RETRIES = 5;

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
];
