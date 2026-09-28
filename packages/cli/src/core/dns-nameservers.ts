import dgram from "node:dgram";
import { promises as dns } from "node:dns";
import { mapWithConcurrency } from "./concurrency.ts";

/** bunny.net delegates every zone to the same two anycast nameservers. */
export const BUNNY_NAMESERVERS = ["kiki.bunny.net", "coco.bunny.net"] as const;

/** Lowercase and drop a trailing dot so nameservers compare cleanly. */
function normalize(ns: string): string {
  return ns.trim().toLowerCase().replace(/\.$/, "");
}

/** Encode a domain into DNS wire-format labels terminated by a root byte. */
function encodeName(domain: string): Buffer {
  const labels = domain.replace(/\.$/, "").split(".");
  const parts = labels.map((label) => {
    const bytes = Buffer.from(label, "ascii");
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

/** Read a (possibly compressed) name; returns the name and the offset past it. */
function decodeName(buf: Buffer, start: number): { name: string; end: number } {
  const labels: string[] = [];
  let pos = start;
  let end = start;
  let jumped = false;
  while (pos < buf.length) {
    const len = buf[pos] ?? 0;
    if (len === 0) {
      if (!jumped) end = pos + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      const pointer = ((len & 0x3f) << 8) | (buf[pos + 1] ?? 0);
      if (!jumped) end = pos + 2;
      pos = pointer;
      jumped = true;
      continue;
    }
    labels.push(buf.toString("ascii", pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return { name: labels.join("."), end };
}

/** Build a non-recursive NS query (with an EDNS0 OPT for larger referrals). */
function buildNsQuery(domain: string): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(Math.floor(Math.random() * 0xffff), 0);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(1, 10);
  const question = Buffer.concat([encodeName(domain), Buffer.alloc(4)]);
  question.writeUInt16BE(2, question.length - 4);
  question.writeUInt16BE(1, question.length - 2);
  const opt = Buffer.from([0, 0, 0x29, 0x10, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([header, question, opt]);
}

/** Pull NS records for `domain` from a DNS message's answer and authority sections. */
function parseNsReferral(buf: Buffer, domain: string): string[] {
  const counts = [6, 8].map((o) => buf.readUInt16BE(o));
  let pos = 12;
  const questions = buf.readUInt16BE(4);
  for (let i = 0; i < questions; i++) pos = decodeName(buf, pos).end + 4;
  const want = normalize(domain);
  const out: string[] = [];
  const records = (counts[0] ?? 0) + (counts[1] ?? 0);
  for (let i = 0; i < records && pos + 10 <= buf.length; i++) {
    const owner = decodeName(buf, pos);
    pos = owner.end;
    const type = buf.readUInt16BE(pos);
    const rdLength = buf.readUInt16BE(pos + 8);
    const rdStart = pos + 10;
    if (type === 2 && normalize(owner.name) === want) {
      out.push(decodeName(buf, rdStart).name);
    }
    pos = rdStart + rdLength;
  }
  return out;
}

/** Send an NS query to one authoritative server; null on timeout/error/truncation. */
function queryNs(
  server: string,
  domain: string,
  timeoutMs = 3000,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket(server.includes(":") ? "udp6" : "udp4");
    let settled = false;
    const finish = (value: string[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on("error", () => finish(null));
    socket.on("message", (msg) => {
      try {
        if (msg.readUInt16BE(2) & 0x0200) return finish(null);
        finish(parseNsReferral(msg, domain));
      } catch {
        finish(null);
      }
    });
    socket.send(buildNsQuery(domain), 53, server, (err) => {
      if (err) finish(null);
    });
  });
}

/**
 * Read the delegation the parent zone publishes for `domain`, which reflects the
 * registrar setup rather than NS the current host might answer for itself.
 * Returns null when the parent referral can't be read (caller falls back).
 */
async function resolveParentDelegation(
  domain: string,
): Promise<string[] | null> {
  const labels = domain.replace(/\.$/, "").split(".");
  if (labels.length < 2) return null;
  const parent = labels.slice(1).join(".");
  let parentNs: string[];
  try {
    parentNs = await dns.resolveNs(parent);
  } catch {
    return null;
  }
  for (const host of parentNs.slice(0, 3)) {
    let ips: string[];
    try {
      ips = await dns.resolve4(host);
    } catch {
      continue;
    }
    for (const ip of ips.slice(0, 2)) {
      const ns = await queryNs(ip, domain);
      if (ns !== null) return ns.map(normalize);
    }
  }
  return null;
}

/** "bunny" = fully delegated to the expected set; "other" = points elsewhere; "unknown" = couldn't resolve. */
export type DelegationStatus = "bunny" | "other" | "unknown";

export interface DelegationCheck {
  status: DelegationStatus;
  /** The NS records the parent zone actually returned, normalized and sorted. */
  resolved: string[];
}

/**
 * Compare a domain's delegation against the expected nameservers. Prefers the
 * parent zone's referral (the registrar delegation) over the recursive answer,
 * which the current DNS host could otherwise spoof with bunny NS records. This
 * is the source of truth, not bunny's NameserversDetected flag (true on a fresh
 * zone).
 */
export async function checkDelegation(
  domain: string,
  expected: readonly string[] = BUNNY_NAMESERVERS,
): Promise<DelegationCheck> {
  const want = new Set(expected.map(normalize));
  try {
    const parent = await resolveParentDelegation(domain);
    // Fall back to the recursive answer only when the parent referral is unreadable.
    const resolved = (
      parent ?? (await dns.resolveNs(domain)).map(normalize)
    ).sort();
    if (resolved.length === 0) {
      // Empty parent referral is a definite "not delegated to bunny"; an empty recursive answer is inconclusive.
      return { status: parent ? "other" : "unknown", resolved };
    }
    // Match the full expected set both ways so a partial pair (only kiki, missing coco) stays pending.
    const have = new Set(resolved);
    const status =
      resolved.every((ns) => want.has(ns)) &&
      [...want].every((ns) => have.has(ns))
        ? "bunny"
        : "other";
    return { status, resolved };
  } catch {
    // NXDOMAIN, SERVFAIL, no NS published yet, or no network: can't tell.
    return { status: "unknown", resolved: [] };
  }
}

/** The nameservers a zone delegates to: its custom pair when enabled, else bunny's defaults. */
export function expectedNameservers(zone: {
  CustomNameserversEnabled?: boolean;
  Nameserver1?: string | null;
  Nameserver2?: string | null;
}): readonly string[] {
  if (zone.CustomNameserversEnabled && (zone.Nameserver1 || zone.Nameserver2)) {
    return [zone.Nameserver1, zone.Nameserver2].filter((ns): ns is string =>
      Boolean(ns),
    );
  }
  return BUNNY_NAMESERVERS;
}

/**
 * Resolve delegation for many domains at once, bounded so a large account
 * doesn't fan out into hundreds of simultaneous DNS queries. Results are
 * returned in the same order as the input.
 */
export async function checkDelegations(
  items: { domain: string; expected?: readonly string[] }[],
  concurrency = 10,
): Promise<DelegationCheck[]> {
  return mapWithConcurrency(items, concurrency, (item) =>
    checkDelegation(item.domain, item.expected),
  );
}
