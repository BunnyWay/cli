import type { createDbClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/database.d.ts";
import { TOKEN_TTL_MINUTES } from "./constants.ts";

// Reads live in @bunny.net/actions so every surface sees the same database data.
export {
  fetchAllDatabases,
  fetchDatabase,
  fetchDatabaseWithRegions,
  fetchLiveStatus,
  fetchRegionConfig,
  liveMainRegion,
  liveStatusLabel,
  regionNameMap,
} from "@bunny.net/actions";

type DbClient = ReturnType<typeof createDbClient>;
type GenerateTokenResponse =
  components["schemas"]["GenerateTokenDatabaseV2Response"];
type TokenAuthorization =
  components["schemas"]["GenerateTokenDatabaseV2Payload"]["authorization"];

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
