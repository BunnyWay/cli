import { describe, expect, test } from "bun:test";
import {
  parseRegistryUrl,
  qualifyRepository,
  stripNamespace,
} from "./client.ts";
import { buildTargetRef, parseImageRef } from "./ref.ts";

const NS = "1b26800c-91f5-4a75-8a8e-3de52942d9ce";

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
    expect(buildTargetRef("host.example", NS, "alpine:3.20")).toEqual({
      reference: `host.example/${NS}/alpine:3.20`,
      repository: `${NS}/alpine`,
      displayRepository: "alpine",
      tag: "3.20",
    });
  });

  test("overrides repository and tag", () => {
    expect(
      buildTargetRef("host.example", NS, "alpine:3.20", "Team/Alpine", "v1"),
    ).toEqual({
      reference: `host.example/${NS}/team/alpine:v1`,
      repository: `${NS}/team/alpine`,
      displayRepository: "team/alpine",
      tag: "v1",
    });
  });

  test("keeps an already-namespaced repository as-is", () => {
    expect(
      buildTargetRef("host.example", NS, "alpine:3.20", `${NS}/alpine`, "v1"),
    ).toEqual({
      reference: `host.example/${NS}/alpine:v1`,
      repository: `${NS}/alpine`,
      displayRepository: "alpine",
      tag: "v1",
    });
  });
});

describe("qualifyRepository", () => {
  test("prefixes the namespace", () => {
    expect(qualifyRepository("myapp", NS)).toBe(`${NS}/myapp`);
  });

  test("lowercases and trims slashes", () => {
    expect(qualifyRepository("/Team/MyApp/", NS)).toBe(`${NS}/team/myapp`);
  });

  test("does not double-prefix", () => {
    expect(qualifyRepository(`${NS}/myapp`, NS)).toBe(`${NS}/myapp`);
  });

  test("throws on an empty name", () => {
    expect(() => qualifyRepository("//", NS)).toThrow();
  });
});

describe("stripNamespace", () => {
  test("removes the namespace prefix", () => {
    expect(stripNamespace(`${NS}/myapp`, NS)).toBe("myapp");
  });

  test("leaves other namespaces untouched", () => {
    expect(stripNamespace("other/myapp", NS)).toBe("other/myapp");
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
