import * as BunnyStorage from "@bunny.net/storage-sdk";
import { UserError } from "../../core/errors.ts";
import type { StorageZoneModel } from "./api.ts";

export type StorageFile = BunnyStorage.file.StorageFile;
export type StorageZone = BunnyStorage.zone.StorageZone;
export type UploadOptions = BunnyStorage.file.UploadOptions;

const REGION_CODES = new Set<string>(
  Object.values(BunnyStorage.regions.StorageRegion),
);

export function connectStorageZone(zone: StorageZoneModel): StorageZone {
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
  zone: StorageZone,
  dir: string,
): Promise<StorageFile[]> {
  return BunnyStorage.file.list(zone, dir || "/");
}

export async function uploadFile(
  zone: StorageZone,
  remotePath: string,
  contents: ReadableStream<Uint8Array>,
  options?: UploadOptions,
): Promise<void> {
  await BunnyStorage.file.upload(zone, remotePath, contents, options);
}

export function downloadFile(zone: StorageZone, remotePath: string) {
  return BunnyStorage.file.download(zone, remotePath);
}

export async function deleteFile(
  zone: StorageZone,
  path: string,
): Promise<void> {
  const deleted = path.endsWith("/")
    ? await BunnyStorage.file.removeDirectory(zone, path)
    : await BunnyStorage.file.remove(zone, path);
  if (!deleted) throw new UserError(`Failed to delete ${path}.`);
}
