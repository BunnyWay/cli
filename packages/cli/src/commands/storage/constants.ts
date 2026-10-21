import * as BunnyStorage from "@bunny.net/storage-sdk";
import { UserError } from "@/core/errors.ts";
import { confirm } from "@/core/ui.ts";
import type { StorageRegionModel } from "@/tools/storage/index.ts";
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

export interface RegionScope {
  tier?: ZoneTierChoice;
  s3?: boolean;
}

function toRegion(region: StorageRegionModel): StorageRegion {
  return { code: region.Code ?? "", name: region.Name ?? "" };
}

// The catalog lists each region once per tier; an unscoped zone is Standard (HDD).
function tierRegions(
  catalog: StorageRegionModel[],
  scope: RegionScope,
): StorageRegionModel[] {
  const tier = zoneTierValue(scope.tier ?? "hdd");
  return catalog.filter(
    (region) => region.Tier === tier && (!scope.s3 || region.IsS3Supported),
  );
}

// Every region on any tier, once each.
export function storageRegions(catalog: StorageRegionModel[]): StorageRegion[] {
  const byCode = new Map<string, StorageRegion>();
  for (const region of catalog) {
    if (region.Code && !byCode.has(region.Code))
      byCode.set(region.Code, toRegion(region));
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function mainRegionChoices(
  catalog: StorageRegionModel[],
  scope: RegionScope = {},
): StorageRegion[] {
  return tierRegions(catalog, scope)
    .filter((region) => region.IsMainRegionSupported)
    .map(toRegion);
}

export function regionTierNote(
  catalog: StorageRegionModel[],
  code: string,
): string {
  const wanted = code.toUpperCase();
  const hdd = catalog.find(
    (r) => r.Code === wanted && r.Tier === ZONE_TIERS.hdd.value,
  );
  if (!hdd) return "Edge (SSD), replication only";
  if (!hdd.IsS3Supported) return "No S3";

  return "-";
}

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
  catalog: StorageRegionModel[],
  primaryCode?: string,
  scope: RegionScope = {},
): StorageRegion[] {
  const primary = primaryCode?.toUpperCase();
  return tierRegions(catalog, scope)
    .filter((region) => region.Code !== primary)
    .map(toRegion);
}

function scopeLabel(scope: RegionScope): string {
  const tier = scope.tier === "ssd" ? "Edge (SSD)" : "Standard (HDD)";
  return scope.s3 ? `${tier} with S3` : tier;
}

// Uppercase, validate, and drop the primary region from a list of replication codes.
// `existing` is what the zone already replicates to, which stays valid whether or not it is still on offer.
export function normalizeReplicationRegions(
  catalog: StorageRegionModel[],
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
    ...replicationChoices(catalog, undefined, scope).map(
      (region) => region.code,
    ),
    ...existing.map((region) => region.toUpperCase()),
  ]);
  const rejected = normalized.filter((region) => !allowed.has(region));
  if (rejected.length > 0) {
    const known = storageRegions(catalog).map((region) => region.code);
    const unknown = rejected.filter((region) => !known.includes(region));
    if (unknown.length > 0) {
      throw new UserError(
        `Unknown replication region(s): ${unknown.join(", ")}.`,
        `Valid regions: ${known.join(", ")}.`,
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
