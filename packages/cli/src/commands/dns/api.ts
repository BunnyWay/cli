import type { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { UserError } from "../../core/errors.ts";

export type CoreClient = ReturnType<typeof createCoreClient>;
export type DnsZoneModel = components["schemas"]["DnsZoneModel"];
export type DnsRecordModel = components["schemas"]["DnsRecordModel"];

/** Fetch all DNS zones on the account, paginated and sorted by domain. */
export async function fetchZones(client: CoreClient): Promise<DnsZoneModel[]> {
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
  return zones.sort((a, b) => (a.Domain ?? "").localeCompare(b.Domain ?? ""));
}

/** Fetch a single DNS zone (including its records) by ID. */
export async function fetchZone(
  client: CoreClient,
  id: number,
): Promise<DnsZoneModel> {
  const { data } = await client.GET("/dnszone/{id}", {
    params: { path: { id } },
  });
  if (!data) throw new UserError(`DNS zone ${id} not found.`);
  return data;
}

/**
 * Resolve a zone reference (numeric ID or domain name) to a full zone.
 *
 * Numeric input is treated as a zone ID; anything else is matched against
 * the account's zones by domain name.
 */
export async function resolveZone(
  client: CoreClient,
  domainOrId: string,
): Promise<DnsZoneModel> {
  const ref = domainOrId.trim();
  if (!ref) throw new UserError("A domain or zone ID is required.");

  if (/^\d+$/.test(ref)) return fetchZone(client, Number(ref));

  const { data } = await client.GET("/dnszone", {
    params: { query: { search: ref, perPage: 1000 } },
  });
  const match = (data?.Items ?? []).find(
    (z) => (z.Domain ?? "").toLowerCase() === ref.toLowerCase(),
  );
  if (!match?.Id) {
    throw new UserError(
      `No DNS zone found for "${domainOrId}".`,
      'Run "bunny dns zone list" to see your zones.',
    );
  }
  return fetchZone(client, match.Id);
}
