import { z } from "zod";
import type { Database2, DBLiveStatus } from "./api.ts";

export const DatabaseRegionSchema = z.object({
  code: z.string(),
  name: z
    .string()
    .describe(
      "Display name from the region config; falls back to the code when unknown.",
    ),
});

export type DatabaseRegion = z.infer<typeof DatabaseRegionSchema>;

/** Stable view of a database, with region codes resolved to names. */
export const DatabaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  status: z
    .enum(["active", "idle"])
    .describe("`active` while the database is live, otherwise `idle`."),
  storageRegion: z.string(),
  primaryRegion: DatabaseRegionSchema.nullable(),
  replicaRegions: z.array(DatabaseRegionSchema),
  sizeBytes: z.number(),
  maxSizeBytes: z.number(),
});

export type Database = z.infer<typeof DatabaseSchema>;

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
