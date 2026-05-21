import { describe, expect, test } from "bun:test";
import { parseImageRef } from "./parse-image-ref.ts";

describe("parseImageRef", () => {
  test("bare image name defaults tag to 'latest' and namespace to 'library'", () => {
    expect(parseImageRef("nginx")).toEqual({
      imageName: "nginx",
      imageNamespace: "library",
      imageTag: "latest",
    });
  });

  test("namespaced image without tag defaults to 'latest'", () => {
    expect(parseImageRef("library/redis")).toEqual({
      imageName: "redis",
      imageNamespace: "library",
      imageTag: "latest",
    });
  });

  test("bare image with simple tag defaults namespace to 'library'", () => {
    expect(parseImageRef("nginx:1.27")).toEqual({
      imageName: "nginx",
      imageNamespace: "library",
      imageTag: "1.27",
    });
  });

  test("tag containing dots is preserved", () => {
    expect(parseImageRef("nginx:1.27.0-alpine")).toEqual({
      imageName: "nginx",
      imageNamespace: "library",
      imageTag: "1.27.0-alpine",
    });
  });

  test("empty ref returns all empty fields", () => {
    expect(parseImageRef("")).toEqual({
      imageName: "",
      imageNamespace: "",
      imageTag: "",
    });
  });

  test("two-segment namespace and tag", () => {
    expect(parseImageRef("me/api:v1")).toEqual({
      imageName: "api",
      imageNamespace: "me",
      imageTag: "v1",
    });
  });

  test("hostname + single-segment namespace + tag", () => {
    expect(parseImageRef("ghcr.io/me/api:v1.2")).toEqual({
      imageName: "api",
      imageNamespace: "me",
      imageTag: "v1.2",
    });
  });

  test("hostname + multi-segment namespace joins with /", () => {
    expect(parseImageRef("ghcr.io/org/team/api:v1")).toEqual({
      imageName: "api",
      imageNamespace: "org/team",
      imageTag: "v1",
    });
  });

  test("hostname-only path treats hostname as namespace", () => {
    // Two-segment refs can't distinguish "hostname/image" from "user/image";
    // the parser keeps the first segment as the namespace either way.
    expect(parseImageRef("ghcr.io/api")).toEqual({
      imageName: "api",
      imageNamespace: "ghcr.io",
      imageTag: "latest",
    });
  });

  test("hostname with port and tag — colon in port does not confuse tag detection", () => {
    expect(parseImageRef("ghcr.io:5000/me/api:v1")).toEqual({
      imageName: "api",
      imageNamespace: "me",
      imageTag: "v1",
    });
  });

  test("hostname with port and no tag", () => {
    // The trailing ":5000/api" segment contains a slash, so the parser
    // correctly treats the colon as a port separator (not a tag separator)
    // and the tag falls back to "latest".
    expect(parseImageRef("registry.local:5000/api")).toEqual({
      imageName: "api",
      imageNamespace: "registry.local:5000",
      imageTag: "latest",
    });
  });
});
