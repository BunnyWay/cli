import { expect, test } from "bun:test";
import {
  deployIdFromPreviewZoneName,
  deployPrefix,
  isPreviewZoneName,
  isValidDeployId,
  isValidSiteName,
  parseRemoteState,
  previewZoneName,
  type RemoteSiteState,
  siteResourcePattern,
  suffixedResourceName,
} from "./constants.ts";

const validState: RemoteSiteState = {
  version: 1,
  name: "my-site",
  storageZoneId: 1,
  pullZoneId: 2,
  scriptId: 3,
  deploys: [],
};

test("parseRemoteState round-trips a valid state", () => {
  expect(parseRemoteState(JSON.stringify(validState))).toEqual(validState);
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

test("isValidDeployId accepts git shas and content hashes", () => {
  expect(isValidDeployId("a1b2c3d4")).toBe(true);
  expect(isValidDeployId("0f9e8d7c6b5a4321")).toBe(true);
  expect(isValidDeployId("ab")).toBe(false); // too short
  expect(isValidDeployId("HAS-CAPS")).toBe(false);
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

// Cleanup and site discovery key on the name shape, and the router parses the same shape from the hostname, so the round-trip must be exact and everything else rejected.
test("preview zone names round-trip the deploy id and reject other shapes", () => {
  const name = previewZoneName("a1b2c3d4");
  expect(name).toMatch(/^sites-dpl-a1b2c3d4-[a-z0-9]{6}$/);
  // Worst case (40-char content-hash id) stays inside the 63-char DNS label limit.
  expect(previewZoneName("a".repeat(40)).length).toBeLessThanOrEqual(63);

  expect(deployIdFromPreviewZoneName(name)).toBe("a1b2c3d4");
  expect(deployIdFromPreviewZoneName(name.toUpperCase())).toBe("a1b2c3d4");
  expect(isPreviewZoneName(name)).toBe(true);

  expect(deployIdFromPreviewZoneName("sites-my-site-abc123")).toBeUndefined();
  expect(deployIdFromPreviewZoneName("sites-dpl-abc123")).toBeUndefined();
  expect(deployIdFromPreviewZoneName("dpl-abc123-x1y2z3")).toBeUndefined();
  expect(deployIdFromPreviewZoneName(undefined)).toBeUndefined();
  expect(deployIdFromPreviewZoneName("")).toBeUndefined();
});

// A site named like a deploy would make its zones indistinguishable from preview zones, so the name space is reserved.
test("site names starting with dpl- are rejected", () => {
  expect(isValidSiteName("dpl-abc123")).toBe(false);
  expect(isValidSiteName("dplx-abc123")).toBe(true);
});
