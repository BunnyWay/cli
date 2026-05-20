export interface PortMapping {
  public: number;
  container: number;
}

/**
 * Parse a compose `ports:` entry into `{ public, container }`.
 *
 * Accepts:
 * - `"3000"`              → `{ public: 3000, container: 3000 }`
 * - `"3000:80"`           → `{ public: 3000, container: 80 }`
 * - `"127.0.0.1:3000:80"` → `{ public: 3000, container: 80 }` (host IP stripped)
 * - object form           → `{ public: published ?? target, container: target }`
 *
 * Strips `/tcp` / `/udp` protocol suffixes (we always map TCP).
 * Throws on ranges (`"3000-3005:3000-3005"`); too ambiguous for one endpoint.
 */
export function parsePortMapping(
  entry: string | { target: number; published?: number | string },
): PortMapping {
  if (typeof entry === "object") {
    const target = entry.target;
    const publishedRaw = entry.published ?? target;
    const published =
      typeof publishedRaw === "string"
        ? Number.parseInt(publishedRaw, 10)
        : publishedRaw;
    if (!Number.isFinite(published) || !Number.isFinite(target)) {
      throw new Error(`Invalid port mapping: ${JSON.stringify(entry)}`);
    }
    return { public: published, container: target };
  }

  // String form. Strip protocol suffix and any host IP prefix.
  const noProto = entry.split("/")[0] ?? entry;
  if (noProto.includes("-")) {
    throw new Error(
      `Port range ${entry} is not supported. Use individual port mappings.`,
    );
  }

  const parts = noProto.split(":");

  let publicStr: string;
  let containerStr: string;

  if (parts.length === 1) {
    // "3000"
    publicStr = parts[0] ?? "";
    containerStr = parts[0] ?? "";
  } else if (parts.length === 2) {
    // "3000:80"
    publicStr = parts[0] ?? "";
    containerStr = parts[1] ?? "";
  } else if (parts.length === 3) {
    // "127.0.0.1:3000:80" (drop the IP)
    publicStr = parts[1] ?? "";
    containerStr = parts[2] ?? "";
  } else {
    throw new Error(`Cannot parse port mapping: ${entry}`);
  }

  const publicPort = Number.parseInt(publicStr, 10);
  const containerPort = Number.parseInt(containerStr, 10);

  if (!Number.isFinite(publicPort) || !Number.isFinite(containerPort)) {
    throw new Error(`Cannot parse port mapping: ${entry}`);
  }

  return { public: publicPort, container: containerPort };
}
