import { describe, expect, test } from "bun:test";
import type { DeployRecord } from "./constants.ts";
import {
  deployIdError,
  deployPrefix,
  findDeploy,
  isValidDeployId,
  isValidSiteName,
  parseRemoteState,
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

// Cleanup and site discovery key on the name shape, and the router parses the same shape from the hostname, so the round-trip must be exact and everything else rejected.

describe("deployIdError", () => {
  test("accepts git shas and content hashes", () => {
    expect(deployIdError("a1b2c3d4")).toBeNull();
    expect(deployIdError("0f1e2d3c4b5a")).toBeNull();
  });

  test("accepts the release-style IDs a custom deploy needs", () => {
    for (const id of [
      "20260827-1433-r42",
      "catalog_v3",
      "2026.08.27-r42",
      "v1.2.3",
      "release-2026-08-27t14.33.00z",
    ]) {
      expect(deployIdError(id)).toBeNull();
    }
  });

  // The ID is interpolated into a storage path and into the router's URL pathname.
  test("rejects anything that could escape the deploy prefix", () => {
    for (const id of [
      "../etc/passwd",
      "..",
      "a/../b",
      "deploys/../../x",
      "foo..bar",
      "a/b",
      "a\\b",
      "a b",
      "a?b",
      "a#b",
      "a%2fb",
      "a:b",
    ]) {
      expect(deployIdError(id)).not.toBeNull();
      expect(isValidDeployId(id)).toBe(false);
    }
  });

  test("rejects separators at the edges, so a path segment is never empty or hidden", () => {
    for (const id of ["-abc", "abc-", ".abc", "abc.", "_abc", "abc_"]) {
      expect(deployIdError(id)).not.toBeNull();
    }
  });

  // The ID exists to match whatever produced the deploy, so its case is data, not style.
  test("accepts mixed case and preserves it", () => {
    expect(deployIdError("Release-42")).toBeNull();
    expect(deployIdError("Catalog_V3")).toBeNull();
    expect(deployIdError("ABC1")).toBeNull();
  });

  test("enforces the length bounds", () => {
    expect(deployIdError("abc")).toBe("must be 4 to 64 characters");
    expect(deployIdError("a".repeat(64))).toBeNull();
    expect(deployIdError("a".repeat(65))).toBe("must be 4 to 64 characters");
  });

  test("every accepted ID survives a round trip through a URL pathname", () => {
    for (const id of ["20260827-1433-r42", "2026.08.27-r42", "catalog_v3"]) {
      const url = new URL(`https://example.b-cdn.net/deploys/${id}/index.html`);
      expect(url.pathname).toBe(`/deploys/${id}/index.html`);
    }
  });
});

describe("findDeploy", () => {
  const rec = (id: string): DeployRecord => ({
    id,
    createdAt: "2026-08-27T00:00:00.000Z",
    source: "custom",
    contentHash: "hash1",
    files: 1,
    bytes: 10,
  });

  test("matches exactly, never by case", () => {
    const deploys = [rec("Release-42")];
    expect(findDeploy(deploys, "Release-42").deploy?.id).toBe("Release-42");
    expect(findDeploy(deploys, "release-42").deploy).toBeUndefined();
  });

  test("surfaces a case variant so a miss can say 'did you mean'", () => {
    const deploys = [rec("Release-42")];
    expect(findDeploy(deploys, "release-42").caseVariant?.id).toBe(
      "Release-42",
    );
    expect(findDeploy(deploys, "RELEASE-42").caseVariant?.id).toBe(
      "Release-42",
    );
  });

  test("an exact hit reports no variant", () => {
    const found = findDeploy([rec("Release-42")], "Release-42");
    expect(found.caseVariant).toBeUndefined();
  });

  test("an unrelated id reports neither", () => {
    expect(findDeploy([rec("Release-42")], "r99")).toEqual({
      caseVariant: undefined,
    });
  });
});
