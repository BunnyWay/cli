import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { checkDelegation, expectedNameservers } from "../dns-nameservers.ts";
import { RECORD_TYPES, recordTypeLabel } from "../dns-record-types.ts";
import { UserError } from "../errors.ts";
import { logger } from "../logger.ts";
import { confirm, spinner } from "../ui.ts";
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

export type BunnyDnsResult = "created" | "updated" | "exists" | "declined";

async function writeCnameRecord(
  client: CoreClient,
  zoneId: number,
  name: string,
  value: string,
  recordId?: number,
): Promise<void> {
  const spin = spinner(
    recordId == null ? "Adding DNS record..." : "Updating DNS record...",
  );
  spin.start();
  try {
    const body = { Type: RECORD_TYPES.CNAME, Name: name, Value: value };
    if (recordId == null) {
      await client.PUT("/dnszone/{zoneId}/records", {
        params: { path: { zoneId } },
        body,
      });
    } else {
      await client.POST("/dnszone/{zoneId}/records/{id}", {
        params: { path: { zoneId, id: recordId } },
        body,
      });
    }
  } finally {
    spin.stop();
  }
}

/** True when the record is already a CNAME to `target` (ignoring case and a trailing dot). */
function cnamePointsAt(record: DnsRecordModel, target: string): boolean {
  return (
    record.Type === RECORD_TYPES.CNAME &&
    normalize(record.Value ?? "") === normalize(target)
  );
}

/**
 * Offer to create (or repoint) a CNAME record for a hostname in a Bunny DNS
 * zone. The API validates wildcard hostnames against live DNS when they're
 * added to a pull zone, and that validation wants a CNAME to the zone's
 * system hostname, so this runs before the wildcard attach. Every write is
 * confirmed first; a record that already points at the target skips the prompt.
 */
export async function offerCnameRecord(opts: {
  client: CoreClient;
  hostname: string;
  cnameTarget: string;
  match: BunnyDnsMatch;
  /** Prompt shown before creating a missing record. */
  addMessage?: string;
}): Promise<BunnyDnsResult> {
  const { client, hostname, cnameTarget, match } = opts;
  const { zoneId, zoneDomain, recordName, existing } = match;

  if (existing && cnamePointsAt(existing, cnameTarget)) {
    logger.success(`${hostname} already points here via Bunny DNS.`);
    return "exists";
  }

  if (!existing) {
    if (
      !(await confirm(
        opts.addMessage ?? `Point ${hostname} at ${cnameTarget} now?`,
        { initial: true },
      ))
    ) {
      return "declined";
    }
    await writeCnameRecord(client, zoneId, recordName, cnameTarget);
    logger.success(`Pointed ${hostname} at ${cnameTarget} via Bunny DNS.`);
    return "created";
  }

  logger.warn(
    `${hostname} already has a ${recordTypeLabel(existing.Type)} record in your Bunny DNS (${zoneDomain}).`,
  );
  if (!(await confirm(`Repoint it at ${cnameTarget}?`, { initial: false }))) {
    return "declined";
  }
  if (existing.Id == null) {
    throw new UserError(
      `DNS record for "${hostname}" has no ID: cannot repoint it.`,
      "Update the record manually in the Bunny DNS dashboard.",
    );
  }
  await writeCnameRecord(client, zoneId, recordName, cnameTarget, existing.Id);
  logger.success(`Repointed ${hostname} at ${cnameTarget} via Bunny DNS.`);
  return "updated";
}

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
  if (!(await confirm("Repoint it at this pull zone?", { initial: false }))) {
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
