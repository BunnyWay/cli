import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import {
  BUNNY_NAMESERVERS,
  checkDelegation,
  expectedNameservers,
} from "@/core/dns-nameservers.ts";
import { RECORD_TYPES, recordTypeLabel } from "@/core/dns-record-types.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm, spinner } from "@/core/ui.ts";
import type { CoreClient } from "./client.ts";

type DnsZoneModel = components["schemas"]["DnsZoneModel"];
type DnsRecordModel = components["schemas"]["DnsRecordModel"];

/** Lowercase and drop a trailing dot for comparison. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/** Fetch every DNS zone on the account, paginated. */
async function listAllZones(client: CoreClient): Promise<DnsZoneModel[]> {
  const zones: DnsZoneModel[] = [];
  let page = 1;
  for (;;) {
    const { data } = await client.GET("/dnszone", {
      params: { query: { page, perPage: 1000 } },
    });
    zones.push(...(data?.Items ?? []));
    if (!data?.HasMoreItems) break;
    page++;
  }
  return zones;
}

/** A hostname that falls inside an account-managed Bunny DNS zone. */
export interface BunnyDnsMatch {
  zoneId: number;
  zoneDomain: string;
  /** The record name within the zone — "" for the apex. */
  recordName: string;
  existing: DnsRecordModel | null;
  /** True when the registrar delegates to bunny's nameservers — if false, records here aren't publicly resolvable yet. */
  delegated: boolean;
  /** The nameservers the registrar should delegate to (custom ones when the zone has them). */
  nameservers: readonly string[];
}

/**
 * Find the Bunny DNS zone that owns `hostname`, if any. Matches the
 * longest zone-domain suffix (so `shop.example.com` resolves to zone
 * `example.com`, record name `shop`), then returns the record already
 * sitting at that name. Returns null when the domain isn't on Bunny DNS.
 */
export async function findBunnyDnsZone(
  client: CoreClient,
  hostname: string,
): Promise<BunnyDnsMatch | null> {
  const host = normalize(hostname);

  let best: DnsZoneModel | undefined;
  for (const zone of await listAllZones(client)) {
    const domain = normalize(zone.Domain ?? "");
    if (!domain || !zone.Id) continue;
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    if (!best || domain.length > normalize(best.Domain ?? "").length)
      best = zone;
  }
  if (!best?.Id) return null;

  const domain = normalize(best.Domain ?? "");
  const recordName = host === domain ? "" : host.slice(0, -domain.length - 1);

  // The list endpoint omits records — fetch the full zone for them.
  const { data } = await client.GET("/dnszone/{id}", {
    params: { path: { id: best.Id } },
  });
  const existing =
    (data?.Records ?? []).find((r) => normalize(r.Name ?? "") === recordName) ??
    null;

  // Resolve the live registrar delegation; NameserversDetected defaults to true on a fresh zone.
  const nameservers = expectedNameservers(data ?? {});
  const { status } = await checkDelegation(best.Domain ?? domain, nameservers);

  return {
    zoneId: best.Id,
    zoneDomain: best.Domain ?? domain,
    recordName,
    existing,
    delegated: status === "bunny",
    nameservers,
  };
}

/** True when the record already points at this pull zone. */
function routesHere(record: DnsRecordModel, pullZoneId: number): boolean {
  return (
    record.Type === RECORD_TYPES.PULLZONE && Number(record.Value) === pullZoneId
  );
}

async function addPullZoneRecord(
  client: CoreClient,
  zoneId: number,
  name: string,
  pullZoneId: number,
): Promise<void> {
  const spin = spinner("Adding DNS record...");
  spin.start();
  try {
    // A PullZone record routes the name straight at the pull zone and works at the apex (where CNAMEs can't).
    await client.PUT("/dnszone/{zoneId}/records", {
      params: { path: { zoneId } },
      body: { Type: RECORD_TYPES.PULLZONE, Name: name, PullZoneId: pullZoneId },
    });
  } finally {
    spin.stop();
  }
}

async function repointPullZoneRecord(
  client: CoreClient,
  zoneId: number,
  recordId: number,
  name: string,
  pullZoneId: number,
): Promise<void> {
  const spin = spinner("Updating DNS record...");
  spin.start();
  try {
    await client.POST("/dnszone/{zoneId}/records/{id}", {
      params: { path: { zoneId, id: recordId } },
      body: {
        Type: RECORD_TYPES.PULLZONE,
        Name: name,
        PullZoneId: pullZoneId,
        Value: null,
      },
    });
  } finally {
    spin.stop();
  }
}

/** The longest suffix of `hostname` (never the bare TLD) already delegated to bunny's nameservers, or null. */
export async function findDelegatedZoneCandidate(
  hostname: string,
): Promise<string | null> {
  const labels = normalize(hostname).replace(/^\*\./, "").split(".");
  const candidates = labels
    .map((_, i) => labels.slice(i).join("."))
    .filter((name) => name.split(".").length >= 2);
  const checks = await Promise.all(
    candidates.map((name) => checkDelegation(name, BUNNY_NAMESERVERS)),
  );
  const index = checks.findIndex((c) => c.status === "bunny");
  return index === -1 ? null : (candidates[index] ?? null);
}

async function createZone(client: CoreClient, domain: string): Promise<number> {
  const spin = spinner("Creating DNS zone...");
  spin.start();
  try {
    await client.POST("/dnszone", { body: { Domain: domain } });
    // The create response has no body, so look the zone up to get its ID.
    const { data } = await client.GET("/dnszone", {
      params: { query: { search: domain, perPage: 1000 } },
    });
    const created = (data?.Items ?? []).find(
      (z) => normalize(z.Domain ?? "") === normalize(domain),
    );
    if (created?.Id == null) {
      throw new UserError(
        `Created DNS zone ${domain}, but couldn't look it up afterwards.`,
        `Check it with: bunny dns zones show ${domain}`,
      );
    }
    return created.Id;
  } finally {
    spin.stop();
  }
}

export async function offerBunnyDnsZone(opts: {
  client: CoreClient;
  hostname: string;
  domain: string;
}): Promise<BunnyDnsMatch | null> {
  logger.log();
  logger.info(
    `${opts.domain} already uses bunny.net's nameservers, but there's no Bunny DNS zone for it yet.`,
  );
  if (
    !(await confirm(`Create a Bunny DNS zone for ${opts.domain}?`, {
      initial: true,
      optional: true,
    }))
  ) {
    logger.dim(`  Create it later with: bunny dns zones create ${opts.domain}`);
    return null;
  }

  const zoneId = await createZone(opts.client, opts.domain);
  logger.success(`Created DNS zone ${opts.domain} (ID: ${zoneId}).`);

  const host = normalize(opts.hostname);
  const domain = normalize(opts.domain);
  return {
    zoneId,
    zoneDomain: opts.domain,
    recordName: host === domain ? "" : host.slice(0, -domain.length - 1),
    existing: null,
    delegated: true,
    nameservers: BUNNY_NAMESERVERS,
  };
}

export type BunnyDnsResult = "created" | "updated" | "exists" | "declined";

/**
 * Offer to point a Bunny DNS record at the pull zone. Every write is confirmed
 * first; the one exception is a record that already routes here. The result
 * lets the caller skip the manual-DNS steps and propagation wait once a record
 * is in place.
 */
export async function offerBunnyDnsRecord(opts: {
  client: CoreClient;
  hostname: string;
  pullZoneId: number;
  match: BunnyDnsMatch;
}): Promise<BunnyDnsResult> {
  const { client, hostname, pullZoneId, match } = opts;
  const { zoneId, zoneDomain, recordName, existing } = match;

  if (existing && routesHere(existing, pullZoneId)) {
    logger.success(`${hostname} already routes here via Bunny DNS.`);
    return "exists";
  }

  logger.log();

  if (!existing) {
    logger.success(`Found ${zoneDomain} in your Bunny DNS.`);
    if (
      !(await confirm(`Point ${hostname} at this pull zone now?`, {
        initial: true,
        optional: true,
      }))
    ) {
      return "declined";
    }
    await addPullZoneRecord(client, zoneId, recordName, pullZoneId);
    logger.success(`Pointed ${hostname} here via Bunny DNS.`);
    return "created";
  }

  const isBunnyRoute =
    existing.Type === RECORD_TYPES.PULLZONE ||
    existing.Type === RECORD_TYPES.SCRIPT;
  const detail = isBunnyRoute
    ? "points at another bunny resource"
    : `has a ${recordTypeLabel(existing.Type)} record`;
  logger.warn(
    `${hostname} already ${detail} in your Bunny DNS (${zoneDomain}).`,
  );
  if (
    !(await confirm("Repoint it at this pull zone?", {
      initial: false,
      optional: true,
    }))
  ) {
    return "declined";
  }
  if (existing.Id == null) {
    throw new UserError(
      `DNS record for "${hostname}" has no ID — cannot repoint it.`,
      "Update the record manually in the Bunny DNS dashboard.",
    );
  }
  await repointPullZoneRecord(
    client,
    zoneId,
    existing.Id,
    recordName,
    pullZoneId,
  );
  logger.success(`Repointed ${hostname} here via Bunny DNS.`);
  return "updated";
}
