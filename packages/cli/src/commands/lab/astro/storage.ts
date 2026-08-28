/**
 * The zone's files, as this command uses them.
 *
 * A thin layer over the storage SDK, so nothing above it knows how a connection
 * is made. `bunny sites` has the same layer for the same reason; sharing one
 * would tie the two commands together again.
 */
import { UserError } from "../../../core/errors.ts";
import type { StorageZoneModel } from "../../storage/api.ts";
import {
  connectStorageZone,
  deleteFile,
  downloadFile,
  listFiles,
  type StorageZone,
  uploadFile,
} from "../../storage/files-api.ts";

export type { StorageZone } from "../../storage/files-api.ts";

/** A connection that can read and write the zone. */
export function connect(zone: StorageZoneModel): StorageZone {
  return connectStorageZone(zone);
}

export const zoneFiles = {
  upload: uploadFile,
  download: downloadFile,
  remove: deleteFile,
  list: listFiles,
};

/**
 * Frankfurt has no prefix; every other region is `<code>.storage.bunnycdn.com`.
 *
 * The script reads this at run time, and a wrong endpoint means every stored
 * path answers 404 while the zone itself is perfectly healthy.
 */
export function storageHostFor(region: string | null | undefined): string {
  const code = (region ?? "de").toLowerCase();
  return code === "de" || code === ""
    ? "storage.bunnycdn.com"
    : `${code}.storage.bunnycdn.com`;
}

/** The deploy folders the zone holds, newest name order not implied. */
export async function listDeployIds(
  connection: StorageZone,
): Promise<string[]> {
  const entries = await zoneFiles.list(connection, "deploys/").catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.objectName ?? "")
    .filter((name) => name !== "");
}

/**
 * Delete every deploy folder but the ones named.
 *
 * A deploy this command does not keep is dead weight: nothing can publish it,
 * because there is no rollback. The one before the current release stays, so a
 * deploy that has not reached every edge node yet still has its files.
 */
export async function pruneDeploys(
  connection: StorageZone,
  keep: string[],
): Promise<string[]> {
  const kept = new Set(keep.filter(Boolean));
  const removed: string[] = [];
  for (const id of await listDeployIds(connection)) {
    if (kept.has(id)) continue;
    try {
      await zoneFiles.remove(connection, `deploys/${id}/`);
      removed.push(id);
    } catch {
      // Storage the next deploy prunes again, not a failed deploy.
    }
  }
  return removed;
}

/** The zone's read-only password, which is what the script gets. */
export function readOnlyPassword(zone: StorageZoneModel): string {
  const password = zone.ReadOnlyPassword ?? zone.Password;
  if (!password) {
    throw new UserError(
      `Storage zone ${zone.Name} reports no password.`,
      "Re-run the command; if it persists, check the zone in the dashboard.",
    );
  }
  return password;
}
