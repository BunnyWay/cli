import { UserError } from "@bunny.net/openapi-client";
import type { StorageZoneModel } from "./api.ts";

/**
 * Stable, credential-free view of a storage zone.
 *
 * Actions return this rather than the raw API model so the CLI, MCP tools, and
 * agents all see the same field names regardless of API-side naming churn.
 */
export interface StorageZone {
  id: number;
  name: string;
  region: string;
  replicationRegions: string[];
  hostname: string | null;
  filesStored: number;
  storageUsed: number;
  dateModified: string | null;
  s3: {
    enabled: boolean;
    /** Only set when S3 compatibility is enabled on the zone. */
    endpoint: string | null;
  };
}

export function isS3Enabled(zone: StorageZoneModel): boolean {
  return zone.StorageZoneType === 1;
}

// Edge Storage S3 endpoint, e.g. https://de-s3.storage.bunnycdn.com
export function s3Endpoint(zone: StorageZoneModel): string {
  return `https://${(zone.Region ?? "").toLowerCase()}-s3.storage.bunnycdn.com`;
}

export interface S3Credentials {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3Credentials(
  zone: StorageZoneModel,
  readOnly: boolean,
): S3Credentials {
  const secret = readOnly ? zone.ReadOnlyPassword : zone.Password;
  if (!zone.Name || !secret) {
    throw new UserError(
      `No ${readOnly ? "read-only " : ""}password available for storage zone ${zone.Name ?? "?"}.`,
    );
  }
  return {
    endpoint: s3Endpoint(zone),
    region: (zone.Region ?? "").toLowerCase(),
    accessKeyId: zone.Name,
    secretAccessKey: secret,
  };
}

export function toStorageZone(zone: StorageZoneModel): StorageZone {
  const s3 = isS3Enabled(zone);
  return {
    id: zone.Id ?? 0,
    name: zone.Name ?? "",
    region: zone.Region ?? "",
    replicationRegions: zone.ReplicationRegions ?? [],
    hostname: zone.StorageHostname ?? null,
    filesStored: zone.FilesStored ?? 0,
    storageUsed: zone.StorageUsed ?? 0,
    dateModified: zone.DateModified ?? null,
    s3: { enabled: s3, endpoint: s3 ? s3Endpoint(zone) : null },
  };
}
