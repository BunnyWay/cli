import * as BunnyStorage from "@bunny.net/storage-sdk";
import { UserError } from "../../core/errors.ts";
import type { StorageZoneModel } from "./api.ts";

// The SDK types its upload stream as node:stream/web; borrow that exact type so casts stay in sync.
type UploadStream = Parameters<typeof BunnyStorage.file.upload>[2];

export type StorageZone = BunnyStorage.zone.StorageZone;
export type UploadOptions = BunnyStorage.file.UploadOptions;

export interface StorageFile {
  guid: string;
  userId: string;
  lastChanged: Date;
  dateCreated: Date;
  storageZoneName: string;
  storageZoneId: number;
  path: string;
  objectName: string;
  length: number;
  isDirectory: boolean;
  serverId: number;
  checksum: string | null;
  replicatedZones: string[] | null;
  contentType: string;
}

interface StorageFileResponse {
  Guid: string;
  UserId: string;
  LastChanged: string;
  DateCreated: string;
  StorageZoneName: string;
  StorageZoneId: number;
  Path: string;
  ObjectName: string;
  Length: number;
  IsDirectory: boolean;
  ServerId: number;
  Checksum: string | null;
  ReplicatedZones: string | null;
  ContentType: string;
}

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

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "");
}

export function isZoneRoot(path: string): boolean {
  return normalizePath(path).replace(/\/+$/, "") === "";
}

function objectUrl(zone: StorageZone, path: string, directory: boolean): URL {
  const url = BunnyStorage.zone.addr(zone);
  let clean = normalizePath(path);
  if (directory && clean !== "" && !clean.endsWith("/")) clean = `${clean}/`;
  url.pathname = `${url.pathname}${clean}`;
  return url;
}

function listError(zone: StorageZone, status: number, dir: string): UserError {
  const where = dir ? `"${dir}"` : "the zone root";
  if (status === 401) {
    return new UserError(
      `Unauthorized access to storage zone ${zone.name}.`,
      "The zone password may be stale. Re-run the command to refetch it.",
    );
  }
  if (status === 404)
    return new UserError(`Path not found in ${zone.name}: ${where}.`);
  return new UserError(
    `Failed to list ${where} in ${zone.name} (HTTP ${status}).`,
  );
}

export async function listFiles(
  zone: StorageZone,
  dir: string,
): Promise<StorageFile[]> {
  const [header, value] = BunnyStorage.zone.key(zone);
  const response = await fetch(objectUrl(zone, dir, true), {
    headers: { Accept: "application/json", [header]: value },
  });
  if (!response.ok) throw listError(zone, response.status, dir);

  const entries = (await response.json()) as StorageFileResponse[];
  return entries.map((entry) => ({
    guid: entry.Guid,
    userId: entry.UserId,
    lastChanged: new Date(entry.LastChanged),
    dateCreated: new Date(entry.DateCreated),
    storageZoneName: entry.StorageZoneName,
    storageZoneId: entry.StorageZoneId,
    path: entry.Path,
    objectName: entry.ObjectName,
    length: entry.Length,
    isDirectory: entry.IsDirectory,
    serverId: entry.ServerId,
    checksum: entry.Checksum,
    replicatedZones: splitZones(entry.ReplicatedZones),
    contentType: entry.ContentType,
  }));
}

function splitZones(value: string | null): string[] | null {
  if (!value) return null;
  const zones = value
    .split(",")
    .map((zone) => zone.trim())
    .filter(Boolean);
  return zones.length > 0 ? zones : null;
}

export async function uploadFile(
  zone: StorageZone,
  remotePath: string,
  contents: ReadableStream<Uint8Array>,
  options?: UploadOptions,
): Promise<void> {
  // Bun's web-standard ReadableStream is compatible at runtime; bridge the nominal type gap.
  await BunnyStorage.file.upload(
    zone,
    normalizePath(remotePath),
    contents as UploadStream,
    options,
  );
}

export function downloadFile(zone: StorageZone, remotePath: string) {
  return BunnyStorage.file.download(zone, normalizePath(remotePath));
}

function deleteError(
  zone: StorageZone,
  status: number,
  path: string,
): UserError {
  if (status === 401) {
    return new UserError(
      `Unauthorized access to storage zone ${zone.name}.`,
      "The zone password may be stale. Re-run the command to refetch it.",
    );
  }
  if (status === 404) {
    return new UserError(`Path not found in ${zone.name}: "${path}".`);
  }
  return new UserError(
    `Failed to delete "${path}" from ${zone.name} (HTTP ${status}).`,
  );
}

// Issued here rather than via the SDK: it collapses the response to a boolean and cannot bypass the root guard.
export async function deleteFile(
  zone: StorageZone,
  path: string,
): Promise<void> {
  const url = objectUrl(zone, path, path.endsWith("/"));
  // Deleting the zone root needs an explicit opt-in; the caller confirms before reaching here.
  if (isZoneRoot(path)) url.searchParams.set("allowRootDelete", "true");

  const [header, value] = BunnyStorage.zone.key(zone);
  const response = await fetch(url, {
    method: "DELETE",
    headers: { [header]: value },
  });
  if (!response.ok) throw deleteError(zone, response.status, path);
}
