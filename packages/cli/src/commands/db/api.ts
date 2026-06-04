import type { createDbClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/database.d.ts";
import { UserError } from "../../core/errors.ts";
import { DB_PAGE_SIZE, TOKEN_TTL_MINUTES } from "./constants.ts";

type DbClient = ReturnType<typeof createDbClient>;
type Database = components["schemas"]["Database2"];
type RegionConfig = components["schemas"]["ListConfigAPIResponse"];
type GenerateTokenResponse =
  components["schemas"]["GenerateTokenDatabaseV2Response"];
type TokenAuthorization =
  components["schemas"]["GenerateTokenDatabaseV2Payload"]["authorization"];
type DBLiveStatus = components["schemas"]["DBLiveStatus"];

/** Fetch a single database by ID, throwing a UserError if it doesn't exist. */
export async function fetchDatabase(
  client: DbClient,
  id: string,
): Promise<Database> {
  const { data } = await client.GET("/v2/databases/{db_id}", {
    params: { path: { db_id: id } },
  });
  if (!data?.db) throw new UserError(`Database ${id} not found.`);
  return data.db;
}

/** Fetch every database in the account, paginating until exhausted. */
export async function fetchAllDatabases(client: DbClient): Promise<Database[]> {
  const all: Database[] = [];
  let page = 1;

  while (true) {
    const { data } = await client.GET("/v2/databases", {
      params: { query: { page, per_page: DB_PAGE_SIZE } },
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
): Promise<RegionConfig> {
  const { data } = await client.GET("/v1/config", { params: {} });
  if (!data) throw new UserError("Could not fetch region configuration.");
  return data;
}

/** Fetch a database and the region config in parallel. */
export async function fetchDatabaseWithRegions(
  client: DbClient,
  id: string,
): Promise<{ db: Database; config: RegionConfig }> {
  const [db, config] = await Promise.all([
    fetchDatabase(client, id),
    fetchRegionConfig(client),
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

/** RFC 3339 timestamp `minutes` from now (defaults to the token TTL). */
export function tokenExpiryFromNow(minutes = TOKEN_TTL_MINUTES): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

/** Fetch live status metrics for the given database IDs. */
export async function fetchLiveStatus(
  client: DbClient,
  ids: string[],
): Promise<Record<string, DBLiveStatus>> {
  const { data } = await client.POST("/v1/live/live_db", {
    body: { db_ids: ids },
  });
  return data?.live_metrics ?? {};
}

/** "Active" when the database is live, otherwise "Idle". */
export function liveStatusLabel(live: DBLiveStatus | undefined): string {
  return live?.state === "Live" ? "Active" : "Idle";
}

/** Primary region code from live metadata, or null when not live. */
export function liveMainRegion(live: DBLiveStatus | undefined): string | null {
  return live?.state === "Live" ? live.metadata.main : null;
}
