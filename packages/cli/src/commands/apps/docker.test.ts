import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../test-utils/temp-dir.ts";
import { dockerHasCredentials, imageHostname } from "./docker.ts";

describe("imageHostname", () => {
  test.each([
    ["nginx", null],
    ["nginx:1.27", null],
    ["library/redis", null],
    ["ghcr.io/me/api:v1", "ghcr.io"],
    ["registry.example.com/foo/bar", "registry.example.com"],
    ["localhost/foo:1", "localhost"],
    ["localhost:5000/foo:1", "localhost:5000"],
  ])("imageHostname(%j) → %j", (input, expected) => {
    expect(imageHostname(input)).toBe(expected);
  });
});

describe("dockerHasCredentials", () => {
  const tempDir = useTempDir("bunny-docker-");
  const configFile = () => join(tempDir(), "config.json");

  test("returns false when the config file does not exist", () => {
    expect(dockerHasCredentials("ghcr.io", configFile())).toBe(false);
  });

  test("returns false when the config has no matching entry", () => {
    writeFileSync(configFile(), JSON.stringify({ auths: { "docker.io": {} } }));
    expect(dockerHasCredentials("ghcr.io", configFile())).toBe(false);
  });

  test("returns true when auths has the hostname (even with empty value)", () => {
    writeFileSync(configFile(), JSON.stringify({ auths: { "ghcr.io": {} } }));
    expect(dockerHasCredentials("ghcr.io", configFile())).toBe(true);
  });

  test("returns true when auths has the hostname with an auth string", () => {
    writeFileSync(
      configFile(),
      JSON.stringify({ auths: { "ghcr.io": { auth: "dXNlcjpwYXNz" } } }),
    );
    expect(dockerHasCredentials("ghcr.io", configFile())).toBe(true);
  });

  test("returns true when credHelpers has the hostname (Docker Desktop pattern)", () => {
    writeFileSync(
      configFile(),
      JSON.stringify({ credHelpers: { "ghcr.io": "osxkeychain" } }),
    );
    expect(dockerHasCredentials("ghcr.io", configFile())).toBe(true);
  });

  test("returns false on malformed JSON", () => {
    writeFileSync(configFile(), "{not json");
    expect(dockerHasCredentials("ghcr.io", configFile())).toBe(false);
  });
});
