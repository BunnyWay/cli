import { TOKEN_TTL_MINUTES } from "./constants.ts";

// Database API access lives in @bunny.net/actions so every surface reads it the same way.
export {
  fetchAllDatabases,
  fetchDatabase,
  fetchDatabaseWithRegions,
  fetchLiveStatus,
  fetchRegionConfig,
  generateToken,
  liveMainRegion,
  liveStatusLabel,
  regionNameMap,
} from "@bunny.net/actions";

/** RFC 3339 timestamp `minutes` from now (defaults to the token TTL). */
export function tokenExpiryFromNow(minutes = TOKEN_TTL_MINUTES): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}
