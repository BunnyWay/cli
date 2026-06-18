import { describe, expect, test } from "bun:test";
import { parseRegistryUrl } from "./client.ts";
import { buildTargetRef, parseImageRef } from "./ref.ts";

describe("parseImageRef", () => {
  test.each([
    ["alpine:3.20", { name: "alpine", tag: "3.20" }],
    ["alpine", { name: "alpine", tag: "latest" }],
    ["org/app:1.0", { name: "org/app", tag: "1.0" }],
    ["ghcr.io/org/app:1.0", { name: "org/app", tag: "1.0" }],
    ["registry:5000/app:dev", { name: "app", tag: "dev" }],
    ["MyApp:Latest", { name: "myapp", tag: "Latest" }],
  ])("parseImageRef(%j)", (input, expected) => {
    expect(parseImageRef(input)).toEqual(expected);
  });
});

describe("buildTargetRef", () => {
  test("defaults repository and tag from the source", () => {
    expect(buildTargetRef("host.example", "alpine:3.20")).toEqual({
      reference: "host.example/alpine:3.20",
      repository: "alpine",
      tag: "3.20",
    });
  });

  test("overrides repository and tag", () => {
    expect(
      buildTargetRef("host.example", "alpine:3.20", "Team/Alpine", "v1"),
    ).toEqual({
      reference: "host.example/team/alpine:v1",
      repository: "team/alpine",
      tag: "v1",
    });
  });
});

describe("parseRegistryUrl", () => {
  test("defaults scheme to https and strips trailing slash", () => {
    expect(parseRegistryUrl("example.bunny.run/")).toEqual({
      baseUrl: "https://example.bunny.run",
      host: "example.bunny.run",
    });
  });

  test("keeps an explicit scheme and port", () => {
    expect(parseRegistryUrl("http://localhost:5000")).toEqual({
      baseUrl: "http://localhost:5000",
      host: "localhost:5000",
    });
  });
});
