import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The known-hosts file shared by the CLI and libssh2.
 */
export function sandboxKnownHostsPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "bunny", "sandbox_known_hosts");
}

/** OpenSSH known_hosts label; non-default ports are bracketed. */
function hostLabel(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

/** Algorithm name from the front of an SSH public-key blob, or null if malformed. */
function keyType(key: Buffer): string | null {
  if (key.length < 4) return null;
  const len = key.readUInt32BE(0);
  if (4 + len > key.length) return null;
  return key.toString("ascii", 4, 4 + len);
}

/**
 * Trust-on-first-use check for a server host key (`key` is the raw public-key
 * blob).
 * The first key seen for a host is recorded and trusted.
 * A later connection presenting a different key, or a key type the host was
 * never pinned with, is rejected, catching an impostor before the token is
 * sent as the password.
 */
export function verifyKnownHost(
  host: string,
  port: number,
  key: Buffer,
  path: string = sandboxKnownHostsPath(),
): boolean {
  const type = keyType(key);
  if (!type) return false;
  const label = hostLabel(host, port);
  const encoded = key.toString("base64");

  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // No file yet — first contact.
  }
  let hostSeen = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [hosts, lineType, lineKey] = trimmed.split(/\s+/);
    if (!hosts || !lineType || !lineKey) continue;
    // known_hosts allows several comma-separated hosts per line.
    if (!hosts.split(",").includes(label)) continue;
    hostSeen = true;
    if (lineType !== type) continue;
    return lineKey === encoded;
  }
  if (hostSeen) return false;

  try {
    mkdirSync(dirname(path), { recursive: true });
    // Append so concurrent connects don't clobber each other.
    appendFileSync(path, `${label} ${type} ${encoded}\n`, { mode: 0o600 });
  } catch {
    // Can't persist (e.g. read-only home): trust it anyway, like OpenSSH accept-new — no cross-run pin.
  }
  return true;
}
