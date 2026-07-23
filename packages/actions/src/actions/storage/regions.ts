import { UserError } from "@bunny.net/openapi-client";
import * as BunnyStorage from "@bunny.net/storage-sdk";

export interface StorageRegion {
  code: string;
  name: string;
}

// The create API expects uppercase codes (e.g. "DE"), matching what existing zones report.
export const STORAGE_REGIONS: StorageRegion[] = Object.entries(
  BunnyStorage.regions.StorageRegion,
).map(([name, code]) => ({
  code: code.toUpperCase(),
  name: name.replace(/([a-z])([A-Z])/g, "$1 $2"),
}));

export const STORAGE_REGION_CODES: string[] = STORAGE_REGIONS.map(
  (region) => region.code,
);

const REGION_CODES = new Set(STORAGE_REGION_CODES);

// Replication uses the same storage regions as the primary, minus the primary itself.
// (The SDK file ZoneSchema is the physical replication footprint and includes internal
// POPs the create API rejects, so it must not be used as the input set.)
// TODO: Request API endpoint for these
export function replicationChoices(primaryCode?: string): StorageRegion[] {
  const primary = primaryCode?.toUpperCase();
  return STORAGE_REGIONS.filter((region) => region.code !== primary);
}

// Uppercase, validate, and drop the primary region from a list of replication codes.
export function normalizeReplicationRegions(
  regions: string[],
  primaryCode?: string,
): string[] {
  const primary = primaryCode?.toUpperCase();
  const normalized = regions
    .flatMap((region) => region.split(","))
    .map((region) => region.trim().toUpperCase())
    .filter(Boolean);
  const unknown = normalized.filter((region) => !REGION_CODES.has(region));
  if (unknown.length > 0) {
    throw new UserError(
      `Unknown replication region(s): ${unknown.join(", ")}.`,
      `Valid regions: ${[...REGION_CODES].join(", ")}.`,
    );
  }
  return normalized.filter((region) => region !== primary);
}

/** Validate a main region code, returning it uppercased. */
export function normalizeStorageRegion(region: string): string {
  const code = region.trim().toUpperCase();
  if (!REGION_CODES.has(code)) {
    throw new UserError(
      `Unknown storage region "${region}".`,
      `Valid regions: ${[...REGION_CODES].join(", ")}.`,
    );
  }
  return code;
}
