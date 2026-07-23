import { confirm } from "../../core/ui.ts";

// The region vocabulary lives in @bunny.net/actions; only the prompting stays here.
export type { StorageRegion } from "@bunny.net/actions";
export {
  normalizeReplicationRegions,
  normalizeStorageRegion,
  replicationChoices,
  STORAGE_REGION_CODES,
  STORAGE_REGIONS,
} from "@bunny.net/actions";

// `.bunny/storage.json` is written by `bunny storage link` and resolved by storage commands.
export const STORAGE_MANIFEST = "storage.json";

export interface StorageZoneManifest {
  id: number;
  name?: string;
}

export async function confirmAddedReplicationRegions(
  added: string[],
  opts?: { force?: boolean },
): Promise<boolean> {
  if (added.length === 0) return true;
  return confirm(
    `Add replication region(s) ${added.join(", ")}? They cannot be removed once added.`,
    { force: opts?.force },
  );
}
