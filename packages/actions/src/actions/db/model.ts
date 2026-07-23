import type { Database2, DBLiveStatus } from "./api.ts";

export interface DatabaseRegion {
  code: string;
  /** Display name from the region config; falls back to the code when unknown. */
  name: string;
}

/** Stable view of a database, with region codes resolved to names. */
export interface Database {
  id: string;
  name: string;
  url: string;
  /** `active` while the database is live, otherwise `idle`. */
  status: "active" | "idle";
  storageRegion: string;
  primaryRegion: DatabaseRegion | null;
  replicaRegions: DatabaseRegion[];
  sizeBytes: number;
  maxSizeBytes: number;
}

export function toDatabase(
  db: Database2,
  live: DBLiveStatus | undefined,
  regionNames: Map<string, string>,
): Database {
  const region = (code: string): DatabaseRegion => ({
    code,
    name: regionNames.get(code) ?? code,
  });
  const isLive = live?.state === "Live";

  return {
    id: db.id,
    name: db.name,
    url: db.url,
    status: isLive ? "active" : "idle",
    storageRegion: db.storage_region,
    primaryRegion: isLive ? region(live.metadata.main) : null,
    replicaRegions: isLive ? live.metadata.replicas.map(region) : [],
    sizeBytes: db.current_size_bytes,
    maxSizeBytes: db.size_max_bytes,
  };
}
