import { createHash } from "node:crypto";
import { UserError } from "@/core/errors.ts";

/** The Bunny Player embed URL for one video. */
export function embedUrl(libraryId: number, videoId: string): string {
  return `https://player.mediadelivery.net/embed/${libraryId}/${videoId}`;
}

const UNITS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** Parse `90s`, `30m`, `1h`, `7d` (or bare seconds) into seconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd]?)$/i.exec(value.trim());
  if (!match) {
    throw new UserError(
      `Invalid --expires value "${value}".`,
      "Use a number with s, m, h or d, e.g. 30m, 1h or 7d.",
    );
  }
  const amount = Number(match[1]);
  const unit = (match[2] || "s").toLowerCase() as keyof typeof UNITS;
  const seconds = amount * UNITS[unit];
  if (seconds <= 0) throw new UserError("--expires must be greater than 0.");
  return seconds;
}

/**
 * Sign an embed URL for embed view token authentication:
 * `token = SHA256_HEX(token_security_key + video_id + expires)`, with `expires`
 * a Unix timestamp in seconds.
 * See https://bunny.net/docs/stream/token-authentication.
 */
export function signEmbedUrl(
  url: string,
  videoId: string,
  tokenKey: string,
  expires: number,
): string {
  const token = createHash("sha256")
    .update(`${tokenKey}${videoId}${expires}`)
    .digest("hex");
  return `${url}?token=${token}&expires=${expires}`;
}
