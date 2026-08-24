import { expect, test } from "bun:test";
import {
  mainRegionChoices,
  normalizeReplicationRegions,
  type RegionScope,
  regionTierNote,
  replicationChoices,
  STORAGE_REGIONS,
  sdkRegionKey,
  zoneTierLabel,
  zoneTierValue,
} from "./constants.ts";

test("primary regions use uppercase codes and include DE", () => {
  expect(STORAGE_REGIONS.length).toBeGreaterThan(0);
  expect(STORAGE_REGIONS.map((r) => r.code)).toContain("DE");
  for (const region of STORAGE_REGIONS) {
    expect(region.code).toBe(region.code.toUpperCase());
  }
});

test("replicationChoices excludes the primary region", () => {
  const codes = replicationChoices("DE").map((r) => r.code);
  expect(codes).not.toContain("DE");
  expect(codes).toContain("UK");
});

test("normalizeReplicationRegions uppercases, trims, and drops the primary", () => {
  expect(normalizeReplicationRegions(["ny", " sg "], "UK")).toEqual([
    "NY",
    "SG",
  ]);
  expect(normalizeReplicationRegions(["UK", "NY"], "UK")).toEqual(["NY"]);
});

test("normalizeReplicationRegions splits comma-separated entries", () => {
  // yargs array:true passes `--replication LA,SG` as a single element.
  expect(normalizeReplicationRegions(["LA,SG"], "NY")).toEqual(["LA", "SG"]);
  // Mixed comma + repeated flag, with stray whitespace.
  expect(normalizeReplicationRegions(["LA, SG", "UK"], "NY")).toEqual([
    "LA",
    "SG",
    "UK",
  ]);
});

test("normalizeReplicationRegions rejects codes that are not storage regions", () => {
  expect(() => normalizeReplicationRegions(["NY", "MARS"])).toThrow(
    /Unknown replication region/,
  );
});

test("normalizeReplicationRegions rejects regions the zone shape cannot reach", () => {
  expect(() =>
    normalizeReplicationRegions(["NY", "CZ"], "DE", { tier: "hdd" }),
  ).toThrow(/not available on Standard \(HDD\) zones/);
  expect(() =>
    normalizeReplicationRegions(["CZ"], "DE", { tier: "ssd", s3: true }),
  ).toThrow(/not available on Edge \(SSD\) with S3 zones/);
  expect(() =>
    normalizeReplicationRegions(["BR"], "DE", { tier: "hdd", s3: true }),
  ).toThrow(/not available on Standard \(HDD\) with S3 zones/);
});

test("normalizeReplicationRegions keeps a zone's current regions valid", () => {
  // An S3 zone already replicating to BR can still be updated without dropping it.
  expect(
    normalizeReplicationRegions(["br", "ny"], "DE", { s3: true }, ["BR"]),
  ).toEqual(["BR", "NY"]);
  // Without it on the zone, the same input is still rejected.
  expect(() =>
    normalizeReplicationRegions(["br", "ny"], "DE", { s3: true }),
  ).toThrow(/not available/);
});

test("normalizeReplicationRegions accepts Edge-only regions on an SSD zone", () => {
  expect(normalizeReplicationRegions(["cz,mi"], "DE", { tier: "ssd" })).toEqual(
    ["CZ", "MI"],
  );
});

// The four zone shapes the dashboard offers, as of the Miami (MI) rollout.
test("replicationChoices matches the dashboard for every tier and S3 combination", () => {
  const codes = (scope: RegionScope) =>
    replicationChoices("DE", scope)
      .map((r) => r.code)
      .sort();

  expect(codes({ tier: "hdd" })).toEqual(
    ["UK", "SE", "LA", "NY", "SG", "SYD", "BR", "JH"].sort(),
  );
  expect(codes({ tier: "ssd" })).toEqual(
    [
      "UK",
      "ES",
      "CZ",
      "SE",
      "LA",
      "MI",
      "NY",
      "WA",
      "HK",
      "SG",
      "SYD",
      "JP",
      "BR",
      "JH",
    ].sort(),
  );
  // S3 drops Sao Paulo, and the tier stops mattering.
  const s3Codes = ["UK", "SE", "LA", "NY", "SG", "SYD", "JH"].sort();
  expect(codes({ tier: "hdd", s3: true })).toEqual(s3Codes);
  expect(codes({ tier: "ssd", s3: true })).toEqual(s3Codes);
});

test("mainRegionChoices excludes replica-only regions and S3 exclusions", () => {
  const hdd = mainRegionChoices({ tier: "hdd" }).map((r) => r.code);
  expect(hdd).toEqual(["DE", "UK", "SE", "LA", "NY", "SG", "SYD", "BR", "JH"]);
  // Edge (SSD) zones are always stored in DE first.
  expect(mainRegionChoices({ tier: "ssd" }).map((r) => r.code)).toEqual(["DE"]);
  expect(
    mainRegionChoices({ tier: "hdd", s3: true }).map((r) => r.code),
  ).not.toContain("BR");
});

test("regionTierNote flags the constrained regions", () => {
  expect(regionTierNote("MI")).toBe("Edge (SSD), replication only");
  expect(regionTierNote("br")).toBe("No S3");
  expect(regionTierNote("DE")).toBe("-");
});

test("zone tiers map between the CLI vocabulary and the API enum", () => {
  expect(zoneTierValue("hdd")).toBe(0);
  expect(zoneTierValue("ssd")).toBe(1);
  expect(zoneTierLabel({ ZoneTier: 0 })).toBe("HDD");
  expect(zoneTierLabel({ ZoneTier: 1 })).toBe("SSD");
  expect(zoneTierLabel({ ZoneTier: 0 }, "long")).toBe("Standard (HDD)");
  expect(zoneTierLabel({ ZoneTier: 1 }, "long")).toBe("Edge (SSD)");
  expect(zoneTierLabel({})).toBe("-");
});

test("sdkRegionKey maps a zone region code to the SDK enum member", () => {
  expect(sdkRegionKey("DE")).toBe("Falkenstein");
  expect(sdkRegionKey("ny")).toBe("NewYork");
  expect(sdkRegionKey("XX")).toBeUndefined();
});
