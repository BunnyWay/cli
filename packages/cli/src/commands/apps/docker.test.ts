import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../test-utils/temp-dir.ts";
import {
  buildImageRef,
  dockerHasCredentials,
  imageHostname,
  parseDockerfileExposedPorts,
  parseOauthScopes,
} from "./docker.ts";

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

describe("buildImageRef", () => {
  test("includes userName as the namespace segment for ghcr.io", () => {
    expect(
      buildImageRef("ghcr.io", "notrab", "go-magic-containers", "v1"),
    ).toBe("ghcr.io/notrab/go-magic-containers:v1");
  });

  test("lowercases mixed-case usernames and image names", () => {
    expect(
      buildImageRef("ghcr.io", "Bunny-Net", "Go-Magic-Containers", "v1"),
    ).toBe("ghcr.io/bunny-net/go-magic-containers:v1");
  });

  test("trims whitespace from userName", () => {
    expect(buildImageRef("ghcr.io", "  notrab  ", "api", "v1")).toBe(
      "ghcr.io/notrab/api:v1",
    );
  });

  test("omits the namespace when userName is null", () => {
    expect(buildImageRef("registry.example.com", null, "api", "v1")).toBe(
      "registry.example.com/api:v1",
    );
  });

  test("omits the namespace when userName is undefined", () => {
    expect(buildImageRef("registry.example.com", undefined, "api", "v1")).toBe(
      "registry.example.com/api:v1",
    );
  });

  test("omits the namespace when userName is empty/whitespace", () => {
    expect(buildImageRef("registry.example.com", "   ", "api", "v1")).toBe(
      "registry.example.com/api:v1",
    );
  });
});

describe("parseDockerfileExposedPorts", () => {
  test("extracts a single port from `EXPOSE 8080`", () => {
    expect(parseDockerfileExposedPorts("EXPOSE 8080")).toEqual([8080]);
  });

  test("extracts multiple ports from a single EXPOSE line", () => {
    expect(parseDockerfileExposedPorts("EXPOSE 8080 443 8443")).toEqual([
      8080, 443, 8443,
    ]);
  });

  test("handles EXPOSE/tcp explicit protocol", () => {
    expect(parseDockerfileExposedPorts("EXPOSE 8080/tcp")).toEqual([8080]);
  });

  test("skips udp ports - bunny endpoints are TCP", () => {
    expect(parseDockerfileExposedPorts("EXPOSE 53/udp 443/tcp")).toEqual([443]);
  });

  test("dedupes repeated ports across multiple EXPOSE lines", () => {
    const dockerfile = [
      "FROM golang:1.25-alpine",
      "EXPOSE 8080",
      "RUN go build .",
      "EXPOSE 8080",
      "EXPOSE 9090",
    ].join("\n");
    expect(parseDockerfileExposedPorts(dockerfile)).toEqual([8080, 9090]);
  });

  test("is case-insensitive on the directive", () => {
    expect(parseDockerfileExposedPorts("expose 8080")).toEqual([8080]);
  });

  test("ignores invalid port numbers", () => {
    expect(parseDockerfileExposedPorts("EXPOSE 0 99999 foo 443")).toEqual([
      443,
    ]);
  });

  test("strips inline comments", () => {
    expect(parseDockerfileExposedPorts("EXPOSE 8080 # listen here")).toEqual([
      8080,
    ]);
  });

  test("returns empty list when no EXPOSE directives are present", () => {
    const dockerfile = [
      "FROM alpine",
      "RUN apk add curl",
      'CMD ["sleep", "infinity"]',
    ].join("\n");
    expect(parseDockerfileExposedPorts(dockerfile)).toEqual([]);
  });

  test("ignores commented-out EXPOSE lines", () => {
    expect(parseDockerfileExposedPorts("# EXPOSE 8080")).toEqual([]);
  });
});

describe("parseOauthScopes", () => {
  test("parses scopes from the X-Oauth-Scopes header", () => {
    const headers = [
      "HTTP/2.0 200 OK",
      "X-Oauth-Scopes: gist, read:org, repo, workflow, write:packages",
      "Content-Type: application/json",
      "",
      "{}",
    ].join("\r\n");
    expect(parseOauthScopes(headers)).toEqual([
      "gist",
      "read:org",
      "repo",
      "workflow",
      "write:packages",
    ]);
  });

  test("returns an empty list when the header is absent", () => {
    expect(parseOauthScopes("HTTP/2.0 200 OK\r\n\r\n{}")).toEqual([]);
  });

  test("returns an empty list when the header is present but empty", () => {
    expect(parseOauthScopes("X-Oauth-Scopes: ")).toEqual([]);
  });

  test("is case-insensitive on the header name", () => {
    expect(parseOauthScopes("x-oauth-scopes: write:packages")).toEqual([
      "write:packages",
    ]);
  });

  test("trims whitespace around each scope", () => {
    expect(
      parseOauthScopes("X-Oauth-Scopes:   repo  ,  write:packages  "),
    ).toEqual(["repo", "write:packages"]);
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
