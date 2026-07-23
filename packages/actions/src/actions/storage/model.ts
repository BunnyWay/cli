import { UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { StorageZoneModel } from "./api.ts";

/**
 * Stable, credential-free view of a storage zone.
 *
 * Actions return this rather than the raw API model so the CLI, other hosts, and
 * agents all see the same field names regardless of API-side naming churn.
 * Defined as a Zod schema so a host can publish it as the action's output schema.
 */
export const StorageZoneSchema = z.object({
  id: z.number(),
  name: z.string(),
  region: z.string().describe("Main region code, e.g. `DE`."),
  replicationRegions: z.array(z.string()),
  hostname: z.string().nullable(),
  filesStored: z.number(),
  storageUsed: z.number().describe("Bytes used across all regions."),
  dateModified: z.string().nullable(),
  s3: z.object({
    enabled: z.boolean(),
    endpoint: z
      .string()
      .nullable()
      .describe("Only set when S3 compatibility is enabled on the zone."),
  }),
});

export type StorageZone = z.infer<typeof StorageZoneSchema>;

export function isS3Enabled(zone: StorageZoneModel): boolean {
  return zone.StorageZoneType === 1;
}

// Edge Storage S3 endpoint, e.g. https://de-s3.storage.bunnycdn.com
export function s3Endpoint(zone: StorageZoneModel): string {
  return `https://${(zone.Region ?? "").toLowerCase()}-s3.storage.bunnycdn.com`;
}

export const S3CredentialsSchema = z.object({
  endpoint: z.string(),
  region: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
});

export type S3Credentials = z.infer<typeof S3CredentialsSchema>;

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
