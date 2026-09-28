import * as BunnyStorage from "@bunny.net/storage-sdk";
import { UserError } from "@/core/errors.ts";
import { confirm } from "@/core/ui.ts";
import type { StorageZoneModel } from "./api.ts";

export interface StorageRegion {
  code: string;
  name: string;
}

// `.bunny/storage.json` is written by `bunny storage link` and resolved by storage commands.
export const STORAGE_MANIFEST = "storage.json";

export interface StorageZoneManifest {
  id: number;
  name?: string;
}

export const ZONE_TIER_CHOICES = ["hdd", "ssd"] as const;

export const SSD_PRIMARY_REGION = "DE";
export type ZoneTierChoice = (typeof ZONE_TIER_CHOICES)[number];

const ZONE_TIERS: Record<
  ZoneTierChoice,
  { value: 0 | 1; short: string; long: string }
> = {
  hdd: { value: 0, short: "HDD", long: "Standard (HDD)" },
  ssd: { value: 1, short: "SSD", long: "Edge (SSD)" },
};

export function zoneTierValue(choice: ZoneTierChoice): 0 | 1 {
  return ZONE_TIERS[choice].value;
}

export function zoneTierChoice(zone: StorageZoneModel): ZoneTierChoice {
  return zone.ZoneTier === ZONE_TIERS.ssd.value ? "ssd" : "hdd";
}

export function zoneTierLabel(
  zone: StorageZoneModel,
  form: "short" | "long" = "short",
): string {
  const tier = Object.values(ZONE_TIERS).find((t) => t.value === zone.ZoneTier);
  return tier?.[form] ?? "-";
}

interface CatalogRegion extends StorageRegion {
  replicaOnly?: boolean;
  noS3?: boolean;
}

// TODO: Request API endpoint for these
const REGION_CATALOG: CatalogRegion[] = [
  { code: "DE", name: "Frankfurt" },
  { code: "UK", name: "London" },
  { code: "ES", name: "Madrid", replicaOnly: true },
  { code: "CZ", name: "Prague", replicaOnly: true },
  { code: "SE", name: "Stockholm" },
  { code: "LA", name: "Los Angeles" },
  { code: "MI", name: "Miami", replicaOnly: true },
  { code: "NY", name: "New York" },
  { code: "WA", name: "Seattle", replicaOnly: true },
  { code: "HK", name: "Hong Kong", replicaOnly: true },
  { code: "SG", name: "Singapore" },
  { code: "SYD", name: "Sydney" },
  { code: "JP", name: "Tokyo", replicaOnly: true },
  { code: "BR", name: "Sao Paulo", noS3: true },
  { code: "JH", name: "Johannesburg" },
];

export interface RegionScope {
  tier?: ZoneTierChoice;
  s3?: boolean;
}

function inScope(region: CatalogRegion, scope: RegionScope): boolean {
  if (scope.s3 && region.noS3) return false;
  if (region.replicaOnly) return scope.tier === "ssd" && !scope.s3;
  return true;
}

export const STORAGE_REGIONS: StorageRegion[] = REGION_CATALOG.map(
  ({ code, name }) => ({ code, name }),
);

export function mainRegionChoices(scope: RegionScope = {}): StorageRegion[] {
  if (scope.tier === "ssd") {
    return REGION_CATALOG.filter(
      (region) => region.code === SSD_PRIMARY_REGION,
    ).map(({ code, name }) => ({ code, name }));
  }
  return REGION_CATALOG.filter(
    (region) => !region.replicaOnly && inScope(region, scope),
  ).map(({ code, name }) => ({ code, name }));
}

export function regionTierNote(code: string): string {
  const region = REGION_CATALOG.find((r) => r.code === code.toUpperCase());
  if (region?.replicaOnly) return "Edge (SSD), replication only";
  if (region?.noS3) return "No S3";
  return "-";
}

const REGION_CODES = new Set(REGION_CATALOG.map((region) => region.code));

export function sdkRegionKey(
  code: string | null | undefined,
): string | undefined {
  const wanted = (code ?? "").toLowerCase();
  return Object.entries(BunnyStorage.regions.StorageRegion).find(
    ([, value]) => value === wanted,
  )?.[0];
}

// Replication spans every region the zone's tier and S3 setting allow, minus the primary itself.
export function replicationChoices(
  primaryCode?: string,
  scope: RegionScope = {},
): StorageRegion[] {
  const primary = primaryCode?.toUpperCase();
  return REGION_CATALOG.filter(
    (region) => region.code !== primary && inScope(region, scope),
  ).map(({ code, name }) => ({ code, name }));
}

function scopeLabel(scope: RegionScope): string {
  const tier = scope.tier === "ssd" ? "Edge (SSD)" : "Standard (HDD)";
  return scope.s3 ? `${tier} with S3` : tier;
}

// Uppercase, validate, and drop the primary region from a list of replication codes.
// `existing` is what the zone already replicates to, which stays valid whether or not it is still on offer.
export function normalizeReplicationRegions(
  regions: string[],
  primaryCode?: string,
  scope: RegionScope = {},
  existing: string[] = [],
): string[] {
  const primary = primaryCode?.toUpperCase();
  const normalized = regions
    .flatMap((region) => region.split(","))
    .map((region) => region.trim().toUpperCase())
    .filter(Boolean);

  const allowed = new Set([
    ...replicationChoices(undefined, scope).map((region) => region.code),
    ...existing.map((region) => region.toUpperCase()),
  ]);
  const rejected = normalized.filter((region) => !allowed.has(region));
  if (rejected.length > 0) {
    const unknown = rejected.filter((region) => !REGION_CODES.has(region));
    if (unknown.length > 0) {
      throw new UserError(
        `Unknown replication region(s): ${unknown.join(", ")}.`,
        `Valid regions: ${[...REGION_CODES].join(", ")}.`,
      );
    }
    throw new UserError(
      `Replication region(s) ${rejected.join(", ")} are not available on ${scopeLabel(scope)} zones.`,
      `Available: ${[...allowed].join(", ")}.`,
    );
  }
  return normalized.filter((region) => region !== primary);
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
