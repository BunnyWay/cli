import { expect, test } from "bun:test";
import {
  deployPrefix,
  isValidDeployId,
  isValidSiteName,
  parseRemoteState,
  previewHostname,
  previewWildcard,
  type RemoteSiteState,
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

test("deploy path and preview host helpers", () => {
  expect(deployPrefix("a1b2c3d4")).toBe("deploys/a1b2c3d4");
  expect(previewHostname("a1b2c3d4", "example.com")).toBe(
    "dpl-a1b2c3d4.preview.example.com",
  );
  expect(previewWildcard("example.com")).toBe("*.preview.example.com");
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
});
