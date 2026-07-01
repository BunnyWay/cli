import { expect, test } from "bun:test";
import {
  normalizeReplicationRegions,
  replicationChoices,
  STORAGE_REGIONS,
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
  // CZ is in the SDK file ZoneSchema but is not a valid create-time region.
  expect(() => normalizeReplicationRegions(["NY", "CZ"])).toThrow(
    /Unknown replication region/,
  );
});
