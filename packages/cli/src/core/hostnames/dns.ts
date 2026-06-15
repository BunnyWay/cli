import { Resolver, resolve4, resolveCname } from "node:dns/promises";

/** Minimal resolver surface, injectable for tests. */
export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

const systemResolver: DnsResolver = { resolveCname, resolve4 };

/** Public resolvers dodge stale negative caches in the OS/ISP resolver after a record is added. */
function publicResolver(): DnsResolver {
  const resolver = new Resolver({ timeout: 2_000, tries: 1 });
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  return {
    resolveCname: (hostname) => resolver.resolveCname(hostname),
    resolve4: (hostname) => resolver.resolve4(hostname),
  };
}

/** The resolvers consulted by default: the system's, plus a public fallback. */
export function defaultResolvers(): DnsResolver[] {
  return [systemResolver, publicResolver()];
}

/** Lowercase and strip the trailing dot so DNS answers compare cleanly. */
function normalizeDnsName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Check whether `hostname` points at `target`: a CNAME to the target, or
 * (for providers that flatten CNAMEs at the apex) a shared A record.
 * Resolution errors (NXDOMAIN, no records yet) mean "not live yet".
 */
export async function dnsPointsAt(
  hostname: string,
  target: string,
  resolver: DnsResolver = systemResolver,
): Promise<boolean> {
  const want = normalizeDnsName(target);

  try {
    const cnames = await resolver.resolveCname(hostname);
    if (cnames.some((c) => normalizeDnsName(c) === want)) return true;
  } catch {
    // No CNAME record — fall through to the A-record comparison.
  }

  try {
    const [hostIps, targetIps] = await Promise.all([
      resolver.resolve4(hostname),
      resolver.resolve4(target),
    ]);
    const targetSet = new Set(targetIps);
    return hostIps.some((ip) => targetSet.has(ip));
  } catch {
    return false;
  }
}

/** True when any of the given resolvers sees `hostname` pointing at `target`. */
export async function anyResolverPointsAt(
  hostname: string,
  target: string,
  resolvers: DnsResolver[] = defaultResolvers(),
): Promise<boolean> {
  const results = await Promise.all(
    resolvers.map((resolver) => dnsPointsAt(hostname, target, resolver)),
  );
  return results.some(Boolean);
}
