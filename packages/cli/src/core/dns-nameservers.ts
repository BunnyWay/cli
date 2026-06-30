import { promises as dns } from "node:dns";

/** bunny.net delegates every zone to the same two anycast nameservers. */
export const BUNNY_NAMESERVERS = ["kiki.bunny.net", "coco.bunny.net"] as const;

/** Lowercase and drop a trailing dot so nameservers compare cleanly. */
function normalize(ns: string): string {
  return ns.trim().toLowerCase().replace(/\.$/, "");
}

/** "bunny" = fully delegated to the expected set; "other" = points elsewhere; "unknown" = couldn't resolve. */
export type DelegationStatus = "bunny" | "other" | "unknown";

export interface DelegationCheck {
  status: DelegationStatus;
  /** The NS records the parent zone actually returned, normalized and sorted. */
  resolved: string[];
}

/**
 * Resolve a domain's authoritative NS records and compare them against the
 * expected nameservers. This reads the real registrar delegation rather than
 * bunny's NameserversDetected flag, which defaults to true on a fresh zone.
 */
export async function checkDelegation(
  domain: string,
  expected: readonly string[] = BUNNY_NAMESERVERS,
): Promise<DelegationCheck> {
  const want = new Set(expected.map(normalize));
  try {
    const resolved = (await dns.resolveNs(domain)).map(normalize).sort();
    if (resolved.length === 0) return { status: "unknown", resolved };
    const status = resolved.every((ns) => want.has(ns)) ? "bunny" : "other";
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
  const results = new Array<DelegationCheck>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (!item) continue;
      results[index] = await checkDelegation(item.domain, item.expected);
    }
  }
  const lanes = Math.min(concurrency, items.length) || 1;
  await Promise.all(Array.from({ length: lanes }, worker));
  return results;
}
