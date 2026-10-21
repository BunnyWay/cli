import { expect, test } from "bun:test";
import type { StorageRegionOption } from "@/tools/storage/index.ts";
import { normalizeReplicationRegions, sdkRegionKey } from "./constants.ts";

const region = (
  code: string,
  tier: "hdd" | "ssd",
  main: boolean,
  s3: boolean,
): StorageRegionOption => ({
  code,
  name: code,
  continent: null,
  tier,
  main,
  s3,
  pricePerGigabyte: null,
  endpoint: null,
  s3Endpoint: null,
});
const CATALOG = [
  region("DE", "hdd", true, true),
  region("NY", "hdd", true, true),
  region("BR", "hdd", true, false),
  region("CZ", "ssd", false, false),
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
