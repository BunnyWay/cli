import { expect, test } from "bun:test";
import type { DeployRecord } from "./constants.ts";
import {
  deployIdError,
  deployPrefix,
  findDeploy,
  isValidDeployId,
  isValidSiteName,
  type LegacySiteState,
  migrateLegacyState,
  parseLegacyState,
  parseRemoteState,
  type RemoteSiteState,
  siteResourcePattern,
  suffixedResourceName,
} from "./constants.ts";

const validState: RemoteSiteState = {
  version: 2,
  name: "my-site",
  storageZoneId: 1,
  pullZoneId: 2,
  deploys: [],
};

const validLegacyState: LegacySiteState = {
  version: 1,
  name: "my-site",
  storageZoneId: 1,
  pullZoneId: 2,
  scriptId: 3,
  routerVersion: 5,
  deploys: [],
};

test("parseRemoteState round-trips a valid state", () => {
  expect(parseRemoteState(JSON.stringify(validState))).toEqual(validState);
  expect(parseRemoteState(JSON.stringify(validLegacyState))).toBeNull();
});

test("parseLegacyState reads router-era state, and migrating it drops the script fields", () => {
  expect(parseLegacyState(JSON.stringify(validLegacyState))).toEqual(
    validLegacyState,
  );
  // The parsers never both claim a file, so a caller can tell "needs migrating" from "already migrated".
  expect(parseLegacyState(JSON.stringify(validState))).toBeNull();
  expect(parseLegacyState("{}")).toBeNull();

  const migrated = migrateLegacyState({
    ...validLegacyState,
    domain: "example.com",
    current: "abc123",
  });
  expect(migrated).toEqual({
    version: 2,
    name: "my-site",
    storageZoneId: 1,
    pullZoneId: 2,
    domain: "example.com",
    current: "abc123",
    deploys: [],
  });
  expect(parseRemoteState(JSON.stringify(migrated))).toEqual(migrated);
});

test("parseRemoteState rejects garbage", () => {
  expect(parseRemoteState("not json")).toBeNull();
  expect(parseRemoteState("null")).toBeNull();
  expect(parseRemoteState('"a string"')).toBeNull();
  expect(parseRemoteState("{}")).toBeNull();
  // Missing a required resource ID
  expect(
    parseRemoteState(JSON.stringify({ ...validState, pullZoneId: undefined })),
  ).toBeNull();
  // Deploys must be an array
  expect(
    parseRemoteState(JSON.stringify({ ...validState, deploys: {} })),
  ).toBeNull();
  // A future format is rejected rather than misread
  expect(
    parseRemoteState(JSON.stringify({ ...validState, version: 3 })),
  ).toBeNull();
  // A tampered name that isn't a legal zone name is rejected outright, so it
  // can't reach storage paths or generated CI YAML.
  expect(
    parseRemoteState(
      JSON.stringify({ ...validState, name: "evil\n      run: rm -rf /" }),
    ),
  ).toBeNull();
});

test("deploy path helper", () => {
  expect(deployPrefix("a1b2c3d4")).toBe("deploys/a1b2c3d4");
});

test("isValidDeployId accepts git shas, content hashes and caller-supplied IDs", () => {
  expect(isValidDeployId("a1b2c3d4")).toBe(true);
  expect(isValidDeployId("0f9e8d7c6b5a4321")).toBe(true);
  // Case is part of a caller-supplied ID, not something to normalize away.
  expect(isValidDeployId("HAS-CAPS")).toBe(true);
  expect(isValidDeployId("ab")).toBe(false); // too short
  expect(isValidDeployId("has/slash")).toBe(false);
  expect(isValidDeployId("")).toBe(false);
});

test("isValidSiteName enforces zone-name rules", () => {
  expect(isValidSiteName("my-site")).toBe(true);
  expect(isValidSiteName("site123")).toBe(true);
  expect(isValidSiteName("My-Site")).toBe(false);
  expect(isValidSiteName("-leading")).toBe(false);
  expect(isValidSiteName("trailing-")).toBe(false);
  expect(isValidSiteName("ab")).toBe(false); // too short
  expect(isValidSiteName("a".repeat(47))).toBe(true);
  expect(isValidSiteName("a".repeat(48))).toBe(false);
});

test("suffixed resource names round-trip through the site pattern", () => {
  const zoneName = suffixedResourceName("my-site");
  expect(zoneName).toMatch(/^sites-my-site-[a-z0-9]{6}$/);
  const pattern = siteResourcePattern("my-site");
  expect(pattern.test(zoneName)).toBe(true);
  expect(pattern.test("my-site")).toBe(false); // bare name is not a site zone
  expect(pattern.test("my-site-abcdef")).toBe(false); // suffix without the prefix
  expect(pattern.test("sites-my-site")).toBe(false); // prefix without a suffix
  expect(pattern.test("sites-my-site-abcdef1")).toBe(false); // suffix too long
  expect(pattern.test("sites-my-site2-abcdef")).toBe(false); // different site
  expect(siteResourcePattern("other").test(zoneName)).toBe(false);
});

// Cleanup and site discovery key on the name shape, so the round-trip must be exact and everything else rejected.

test("deployIdError accepts shas, hashes, and release-style IDs, case intact", () => {
  for (const id of [
    "a1b2c3d4",
    "0f1e2d3c4b5a",
    "20260827-1433-r42",
    "catalog_v3",
    "2026.08.27-r42",
    "v1.2.3",
    "Release-42",
    "a".repeat(64),
  ]) {
    expect(deployIdError(id)).toBeNull();
  }
});

// The ID is interpolated into a storage path and the rewrite rule's origin URL, so anything
// that could escape the deploy prefix or leave an empty/hidden segment has to be rejected.
test("deployIdError rejects path escapes and edge separators", () => {
  for (const id of [
    "../etc/passwd",
    "a/../b",
    "foo..bar",
    "a/b",
    "a\\b",
    "a b",
    "a?b",
    "a%2fb",
    "-abc",
    "abc.",
    "_abc",
  ]) {
    expect(deployIdError(id)).not.toBeNull();
  }
  expect(deployIdError("abc")).toBe("must be 4 to 64 characters");
  expect(deployIdError("a".repeat(65))).toBe("must be 4 to 64 characters");
});

test("findDeploy matches exactly and surfaces a case variant for 'did you mean'", () => {
  const deploys: DeployRecord[] = [
    {
      id: "Release-42",
      createdAt: "2026-08-27T00:00:00.000Z",
      source: "custom",
      contentHash: "hash1",
      files: 1,
      bytes: 10,
    },
  ];

  expect(findDeploy(deploys, "Release-42")).toEqual({ deploy: deploys[0] });
  expect(findDeploy(deploys, "release-42")).toEqual({
    caseVariant: deploys[0],
  });
  expect(findDeploy(deploys, "r99")).toEqual({ caseVariant: undefined });
});
