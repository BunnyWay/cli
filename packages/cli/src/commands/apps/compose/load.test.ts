import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../../test-utils/temp-dir.ts";
import { findComposeFile, loadComposeFile } from "./index.ts";

const tempDir = useTempDir("bunny-compose-load-");

describe("findComposeFile", () => {
  test("returns null when no compose file exists", () => {
    expect(findComposeFile(tempDir())).toBeNull();
  });

  test("prefers compose.yml over docker-compose.yml", () => {
    writeFileSync(join(tempDir(), "compose.yml"), "services: {}");
    writeFileSync(join(tempDir(), "docker-compose.yml"), "services: {}");
    expect(findComposeFile(tempDir())?.endsWith("/compose.yml")).toBe(true);
  });

  test("accepts docker-compose.yaml", () => {
    writeFileSync(join(tempDir(), "docker-compose.yaml"), "services: {}");
    expect(findComposeFile(tempDir())?.endsWith(".yaml")).toBe(true);
  });
});

describe("loadComposeFile", () => {
  test("parses and validates a simple compose file", () => {
    const path = join(tempDir(), "compose.yml");
    writeFileSync(
      path,
      `services:
  api:
    image: nginx
    ports:
      - "3000:80"
`,
    );
    const result = loadComposeFile(path);
    expect(result.services.api?.image).toBe("nginx");
    expect(result.services.api?.ports).toEqual(["3000:80"]);
  });

  test("preserves unknown top-level keys via passthrough", () => {
    const path = join(tempDir(), "compose.yml");
    writeFileSync(
      path,
      `version: "3.9"
services:
  api:
    image: nginx
networks:
  default: {}
`,
    );
    expect(() => loadComposeFile(path)).not.toThrow();
  });

  test("malformed YAML throws", () => {
    const path = join(tempDir(), "compose.yml");
    writeFileSync(path, "services:\n  api:\n    image: [unclosed\n");
    expect(() => loadComposeFile(path)).toThrow();
  });

  test("missing file throws", () => {
    expect(() => loadComposeFile(join(tempDir(), "nope.yml"))).toThrow(
      /Could not read/,
    );
  });
});
