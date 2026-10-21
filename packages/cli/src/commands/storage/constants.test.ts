import { expect, test } from "bun:test";
import type { StorageRegionModel } from "@/tools/storage/index.ts";
import { normalizeReplicationRegions, sdkRegionKey } from "./constants.ts";

const CATALOG: StorageRegionModel[] = [
  { Code: "DE", Tier: 0, IsMainRegionSupported: true, IsS3Supported: true },
  { Code: "NY", Tier: 0, IsMainRegionSupported: true, IsS3Supported: true },
  { Code: "BR", Tier: 0, IsMainRegionSupported: true, IsS3Supported: false },
  { Code: "CZ", Tier: 1, IsMainRegionSupported: false, IsS3Supported: false },
];

test("normalizeReplicationRegions splits, uppercases, and drops the primary", () => {
  expect(normalizeReplicationRegions(CATALOG, ["ny, br", "de"], "DE")).toEqual([
    "NY",
    "BR",
  ]);
});

test("normalizeReplicationRegions tells unknown codes from ones the zone cannot use", () => {
  expect(() => normalizeReplicationRegions(CATALOG, ["MARS"])).toThrow(
    /Unknown replication region/,
  );
  expect(() =>
    normalizeReplicationRegions(CATALOG, ["CZ"], "DE", { tier: "hdd" }),
  ).toThrow(/not available on Standard \(HDD\) zones/);
});

test("normalizeReplicationRegions keeps a zone's current regions valid", () => {
  expect(
    normalizeReplicationRegions(CATALOG, ["br"], "DE", { s3: true }, ["BR"]),
  ).toEqual(["BR"]);
});

test("sdkRegionKey maps a zone region code to the SDK enum member", () => {
  expect(sdkRegionKey("DE")).toBe("Falkenstein");
  expect(sdkRegionKey("XX")).toBeUndefined();
});
