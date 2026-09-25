// Vimeo input guards; `validateVimeoUrl` is the security boundary that keeps Bunny off arbitrary hosts.

/** Vimeo IDs are numeric. Guards against path traversal in a URL path segment. */
export function validateVimeoId(id: string): boolean {
  return /^\d+$/.test(id);
}

const ALLOWED_VIMEO_HOSTS = [
  "vimeo.com",
  "vimeocdn.com",
  "vod-progressive.akamaized.net",
  "vod-adaptive-ak.vimeocdn.com",
  "player.vimeo.com",
  "f.vimeocdn.com",
  "i.vimeocdn.com",
];

/** HTTPS, and a host on (or a subdomain of) the Vimeo CDN allowlist. */
export function validateVimeoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();

  return ALLOWED_VIMEO_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}
