import { VIDEO_EXTENSIONS } from "@bunny.net/stream-import";

/** S3 has no media-type concept, so extension matching is the only client-side filter available. */
export function isVideoKey(key: string | undefined): boolean {
  if (!key || key.endsWith("/")) return false;
  const dot = key.lastIndexOf(".");
  const slash = key.lastIndexOf("/");
  if (dot < 0 || dot < slash) return false;

  return VIDEO_EXTENSIONS.includes(key.slice(dot).toLowerCase());
}

/** `videos/2024/promo-final.mp4` -> `promo-final` */
export function extractVideoNameFromKey(key: string): string {
  const base = key.slice(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");

  return dot > 0 ? base.slice(0, dot) : base;
}

/** Empty stays empty; anything else gains a single trailing slash. */
export function normalizePrefix(prefix: string): string {
  if (!prefix) return "";
  const trimmed = prefix.replace(/^\/+/, "");
  if (trimmed === "") return "";

  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** `videos/2024/` under root `videos/` -> `2024` */
export function prefixToId(folderPrefix: string, rootPrefix: string): string {
  const stripped = folderPrefix.startsWith(rootPrefix)
    ? folderPrefix.slice(rootPrefix.length)
    : folderPrefix;

  return stripped.replace(/\/+$/, "");
}

/** Inverse of {@link prefixToId}. */
export function idToPrefix(folderId: string, rootPrefix: string): string {
  return `${normalizePrefix(rootPrefix)}${folderId}/`;
}

/** The dedup identity for an S3 object: unique and stable across runs. */
export function toSourceId(bucket: string, key: string): string {
  return `${bucket}/${key}`;
}

/** Inverse of {@link toSourceId}. Keys may contain slashes; the bucket cannot. */
export function fromSourceId(sourceId: string): {
  bucket: string;
  key: string;
} {
  const slash = sourceId.indexOf("/");
  if (slash < 0) return { bucket: sourceId, key: "" };

  return { bucket: sourceId.slice(0, slash), key: sourceId.slice(slash + 1) };
}
