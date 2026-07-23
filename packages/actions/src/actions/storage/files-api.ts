import { UserError } from "@bunny.net/openapi-client";
import * as BunnyStorage from "@bunny.net/storage-sdk";
import { z } from "zod";
import type { StorageZoneModel } from "./api.ts";

// The SDK types its upload stream as node:stream/web; borrow that exact type so casts stay in sync.
type UploadStream = Parameters<typeof BunnyStorage.file.upload>[2];

export type StorageFile = BunnyStorage.file.StorageFile;
export type StorageZoneConnection = BunnyStorage.zone.StorageZone;
export type UploadOptions = BunnyStorage.file.UploadOptions;

const REGION_CODES = new Set<string>(
  Object.values(BunnyStorage.regions.StorageRegion),
);

export function connectStorageZone(
  zone: StorageZoneModel,
): StorageZoneConnection {
  if (!zone.Name) throw new UserError("Storage zone is missing a name.");
  if (!zone.Password) {
    throw new UserError(
      `No password available for storage zone ${zone.Name}.`,
      "Edge Storage file access requires the zone's read-write password.",
    );
  }

  const code = (zone.Region ?? "").toLowerCase();
  if (!REGION_CODES.has(code)) {
    throw new UserError(`Unsupported storage region "${zone.Region}".`);
  }

  return BunnyStorage.zone.connect_with_accesskey(
    code as BunnyStorage.regions.StorageRegion,
    zone.Name,
    zone.Password,
  );
}

export function listFiles(
  zone: StorageZoneConnection,
  dir: string,
): Promise<StorageFile[]> {
  return BunnyStorage.file.list(zone, dir || "/");
}

export async function uploadFile(
  zone: StorageZoneConnection,
  remotePath: string,
  contents: ReadableStream<Uint8Array>,
  options?: UploadOptions,
): Promise<void> {
  // Bun's web-standard ReadableStream is compatible at runtime; bridge the nominal type gap.
  await BunnyStorage.file.upload(
    zone,
    remotePath,
    contents as UploadStream,
    options,
  );
}

export function downloadFile(zone: StorageZoneConnection, remotePath: string) {
  return BunnyStorage.file.download(zone, remotePath);
}

export async function deleteFile(
  zone: StorageZoneConnection,
  path: string,
): Promise<void> {
  const deleted = path.endsWith("/")
    ? await BunnyStorage.file.removeDirectory(zone, path)
    : await BunnyStorage.file.remove(zone, path);
  if (!deleted) throw new UserError(`Failed to delete ${path}.`);
}

/** JSON-safe view of a stored file. Drops the SDK's `_tag` marker and lazy `data()` loader. */
export const StorageFileEntrySchema = z.object({
  name: z.string(),
  path: z
    .string()
    .describe(
      "Zone-relative path, ready to pass back to download/remove (e.g. `images/photo.png`).",
    ),
  isDirectory: z.boolean(),
  size: z.number(),
  contentType: z.string().nullable(),
  checksum: z.string().nullable(),
  lastChanged: z.string().nullable(),
});

export type StorageFileEntry = z.infer<typeof StorageFileEntrySchema>;

// The API reports `path` as `/<zone>/<dir>/`; strip the zone so the result is usable as input.
function zoneRelativeDirectory(file: StorageFile): string {
  const prefix = `/${file.storageZoneName}/`;
  const dir = file.path.startsWith(prefix)
    ? file.path.slice(prefix.length)
    : file.path.replace(/^\//, "");
  return dir && !dir.endsWith("/") ? `${dir}/` : dir;
}

export function toStorageFileEntry(file: StorageFile): StorageFileEntry {
  // Directories keep their trailing slash so `path` can be handed straight back
  // to list/delete, where a slash is what makes the operation recursive.
  const suffix = file.isDirectory ? "/" : "";
  return {
    name: file.objectName,
    path: `${zoneRelativeDirectory(file)}${file.objectName}${suffix}`,
    isDirectory: file.isDirectory,
    size: file.length,
    contentType: file.contentType || null,
    checksum: file.checksum,
    lastChanged: file.lastChanged?.toISOString() ?? null,
  };
}
