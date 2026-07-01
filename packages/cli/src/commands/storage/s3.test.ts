import { expect, test } from "bun:test";
import type { StorageZoneModel } from "./api.ts";
import {
  isS3Enabled,
  renderS3ToolConfig,
  s3Credentials,
  s3Endpoint,
} from "./s3.ts";

const ZONE: StorageZoneModel = {
  Name: "my-zone",
  Password: "rw-pass",
  ReadOnlyPassword: "ro-pass",
  Region: "DE",
  StorageZoneType: 1,
};

test("isS3Enabled reflects the StorageZoneType flag", () => {
  expect(isS3Enabled(ZONE)).toBe(true);
  expect(isS3Enabled({ ...ZONE, StorageZoneType: 0 })).toBe(false);
});

test("s3Endpoint derives a region-prefixed host", () => {
  expect(s3Endpoint(ZONE)).toBe("https://de-s3.storage.bunnycdn.com");
});

test("s3Credentials maps zone name + password and honours --read-only", () => {
  expect(s3Credentials(ZONE, false)).toEqual({
    endpoint: "https://de-s3.storage.bunnycdn.com",
    region: "de",
    accessKeyId: "my-zone",
    secretAccessKey: "rw-pass",
  });
  expect(s3Credentials(ZONE, true).secretAccessKey).toBe("ro-pass");
});

test("s3Credentials throws when the chosen password is missing", () => {
  expect(() =>
    s3Credentials({ ...ZONE, ReadOnlyPassword: null }, true),
  ).toThrow(/read-only password/);
});

test("rclone config is a usable remote block", () => {
  const config = renderS3ToolConfig(
    "rclone",
    s3Credentials(ZONE, false),
    "my-zone",
  );
  expect(config).toContain("[my-zone]");
  expect(config).toContain("type = s3");
  expect(config).toContain("endpoint = https://de-s3.storage.bunnycdn.com");
  expect(config).toContain("secret_access_key = rw-pass");
});

test("env format emits shell-quoted AWS-compatible variables", () => {
  const env = renderS3ToolConfig("env", s3Credentials(ZONE, false), "my-zone");
  expect(env).toContain("AWS_ACCESS_KEY_ID='my-zone'");
  expect(env).toContain(
    "AWS_ENDPOINT_URL='https://de-s3.storage.bunnycdn.com'",
  );
});

test("env format quotes secrets containing shell metacharacters", () => {
  const zone: StorageZoneModel = {
    ...ZONE,
    Password: "a b$(rm -rf /);'\"\n#",
  };
  const env = renderS3ToolConfig("env", s3Credentials(zone, false), "my-zone");
  // Each embedded single quote is closed, escaped, and reopened: '\''
  expect(env).toContain("AWS_SECRET_ACCESS_KEY='a b$(rm -rf /);'\\''\"\n#'");
  // The dangerous substitution must not appear unquoted.
  expect(env).not.toMatch(/AWS_SECRET_ACCESS_KEY=a b/);
});
