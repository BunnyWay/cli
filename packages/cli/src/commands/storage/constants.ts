import * as BunnyStorage from "@bunny.net/storage-sdk";
import { UserError } from "@/core/errors.ts";
import { confirm, withSpinner } from "@/core/ui.ts";
import type { CoreClient } from "@/tools/context.ts";
import {
  fetchStorageRegions,
  type StorageRegionOption,
} from "@/tools/storage/index.ts";
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

export function loadStorageRegions(
  client: CoreClient,
): Promise<StorageRegionOption[]> {
  return withSpinner("Fetching available storage regions...", () =>
    fetchStorageRegions(client),
  );
}

export interface RegionScope {
  tier?: ZoneTierChoice;
  s3?: boolean;
}

function toRegion({ code, name }: StorageRegionOption): StorageRegion {
  return { code, name };
}

// The catalog lists each region once per tier; an unscoped zone is Standard (HDD).
function tierRegions(
  catalog: StorageRegionOption[],
  scope: RegionScope,
): StorageRegionOption[] {
  const tier = scope.tier ?? "hdd";
  return catalog.filter(
    (region) => region.tier === tier && (!scope.s3 || region.s3),
  );
}

export function storageRegions(
  catalog: StorageRegionOption[],
): StorageRegion[] {
  const byCode = new Map<string, StorageRegion>();
  for (const region of catalog) {
    if (!byCode.has(region.code)) byCode.set(region.code, toRegion(region));
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function mainRegionChoices(
  catalog: StorageRegionOption[],
  scope: RegionScope = {},
): StorageRegion[] {
  return tierRegions(catalog, scope)
    .filter((region) => region.main)
    .map(toRegion);
}

export function regionTierNote(
  catalog: StorageRegionOption[],
  code: string,
): string {
  const wanted = code.toUpperCase();
  const hdd = catalog.find((r) => r.code === wanted && r.tier === "hdd");
  if (!hdd) return "Edge (SSD), replication only";
  if (!hdd.s3) return "No S3";

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
  catalog: StorageRegionOption[],
  primaryCode?: string,
  scope: RegionScope = {},
): StorageRegion[] {
  const primary = primaryCode?.toUpperCase();
  return tierRegions(catalog, scope)
    .filter((region) => region.code !== primary)
    .map(toRegion);
}

export function scopeLabel(scope: RegionScope): string {
  const tier = scope.tier === "ssd" ? "Edge (SSD)" : "Standard (HDD)";
  return scope.s3 ? `${tier} with S3` : tier;
}

// Uppercase, validate, and drop the primary region from a list of replication codes.
// `existing` is what the zone already replicates to, which stays valid whether or not it is still on offer.
export function normalizeReplicationRegions(
  catalog: StorageRegionOption[],
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
