import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

/** Split a known_hosts line into its host list and trailing fields, or null for blanks and comments. */
function knownHostsFields(
  line: string,
): { hosts: string; fields: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const [hosts, ...fields] = trimmed.split(/\s+/);
  return hosts ? { hosts, fields } : null;
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  let hostSeen = false;
  for (const line of text.split("\n")) {
    const parsed = knownHostsFields(line);
    if (!parsed) continue;
    const [lineType, lineKey] = parsed.fields;
    if (!lineType || !lineKey) continue;
    // known_hosts allows several comma-separated hosts per line.
    if (!parsed.hosts.split(",").includes(label)) continue;
    hostSeen = true;
    if (lineType !== type) continue;
    if (lineKey === encoded) return true;
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

/**
 * Forget a host's pinned key.
 */
export function removeKnownHost(
  host: string,
  port: number,
  path: string = sandboxKnownHostsPath(),
): void {
  const label = hostLabel(host, port);

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }

  const kept: string[] = [];
  let changed = false;
  for (const line of text.split("\n")) {
    const parsed = knownHostsFields(line);
    if (!parsed) {
      kept.push(line);
      continue;
    }
    const labels = parsed.hosts.split(",");
    if (!labels.includes(label)) {
      kept.push(line);
      continue;
    }
    changed = true;
    // Keep the line for any other hosts it lists; drop it only when this was the last.
    const rest = labels.filter((h) => h !== label);
    if (rest.length > 0) {
      kept.push(line.replace(parsed.hosts, () => rest.join(",")));
    }
  }
  if (!changed) return;

  try {
    writeFileSync(path, kept.join("\n"), { mode: 0o600 });
  } catch {
    // A stale pin is harmless; the next connect re-checks it.
  }
}
