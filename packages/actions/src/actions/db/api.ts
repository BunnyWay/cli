import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/database.d.ts";
import type { DbClient } from "../../context.ts";

export type Database2 = components["schemas"]["Database2"];
export type RegionConfig = components["schemas"]["ListConfigAPIResponse"];
export type DBLiveStatus = components["schemas"]["DBLiveStatus"];
type GenerateTokenResponse =
  components["schemas"]["GenerateTokenDatabaseV2Response"];
export type TokenAuthorization =
  components["schemas"]["GenerateTokenDatabaseV2Payload"]["authorization"];

/** Page size used when paginating the database list endpoint. */
export const DB_PAGE_SIZE = 100;

/** Fetch a single database by ID, throwing a UserError if it doesn't exist. */
export async function fetchDatabase(
  client: DbClient,
  id: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Database2> {
  const { data } = await client.GET("/v2/databases/{db_id}", {
    params: { path: { db_id: id } },
    signal: opts.signal,
  });
  if (!data?.db) throw new UserError(`Database ${id} not found.`);
  return data.db;
}

/** Fetch every database in the account, paginating until exhausted. */
export async function fetchAllDatabases(
  client: DbClient,
  opts: { signal?: AbortSignal } = {},
): Promise<Database2[]> {
  const all: Database2[] = [];
  let page = 1;

  while (true) {
    const { data } = await client.GET("/v2/databases", {
      params: { query: { page, per_page: DB_PAGE_SIZE } },
      signal: opts.signal,
    });

    all.push(...(data?.databases ?? []));

    if (!data?.page_info?.has_more_items) break;
    page++;
  }

  return all;
}

/** Fetch the global region configuration, throwing if unavailable. */
export async function fetchRegionConfig(
  client: DbClient,
  opts: { signal?: AbortSignal } = {},
): Promise<RegionConfig> {
  const { data } = await client.GET("/v1/config", {
    params: {},
    signal: opts.signal,
  });
  if (!data) throw new UserError("Could not fetch region configuration.");
  return data;
}

/** Fetch a database and the region config in parallel. */
export async function fetchDatabaseWithRegions(
  client: DbClient,
  id: string,
  opts: { signal?: AbortSignal } = {},
): Promise<{ db: Database2; config: RegionConfig }> {
  const [db, config] = await Promise.all([
    fetchDatabase(client, id, opts),
    fetchRegionConfig(client, opts),
  ]);
  return { db, config };
}

/** Build a region id → display name lookup from the region config. */
export function regionNameMap(config: RegionConfig): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of [...config.primary_regions, ...config.replica_regions]) {
    map.set(r.id, r.name);
  }
  return map;
}

/** Fetch live status metrics for the given database IDs. */
export async function fetchLiveStatus(
  client: DbClient,
  ids: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<Record<string, DBLiveStatus>> {
  const { data } = await client.POST("/v1/live/live_db", {
    body: { db_ids: ids },
    signal: opts.signal,
  });
  return data?.live_metrics ?? {};
}

/** Generate an auth token for a database. */
export async function generateToken(
  client: DbClient,
  id: string,
  opts: { authorization: TokenAuthorization; expiresAt: string | null },
): Promise<GenerateTokenResponse | undefined> {
  const { data } = await client.PUT("/v2/databases/{db_id}/auth/generate", {
    params: { path: { db_id: id } },
    body: { authorization: opts.authorization, expires_at: opts.expiresAt },
  });
  return data;
}

/** "Active" when the database is live, otherwise "Idle". */
export function liveStatusLabel(live: DBLiveStatus | undefined): string {
  return live?.state === "Live" ? "Active" : "Idle";
}

/** Primary region code from live metadata, or null when not live. */
export function liveMainRegion(live: DBLiveStatus | undefined): string | null {
  return live?.state === "Live" ? live.metadata.main : null;
}
