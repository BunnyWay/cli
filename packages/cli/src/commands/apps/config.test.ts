import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "@/test-utils/temp-dir.ts";
import {
  assertVolumesNotSplit,
  type BunnyAppConfig,
  loadConfig,
  saveConfig,
} from "./config.ts";

const tempDir = useTempDir("bunny-config-");

test("saveConfig preserves comments and a sibling sites block on an existing file", () => {
  const path = join(tempDir(), "mixed.jsonc");
  writeFileSync(
    path,
    `{
  // my deploy config
  "version": "2026-05-11",
  "app": {
    "name": "demo",
    "id": "app_legacy",
    "containers": {
      "api": { "dockerfile": "Dockerfile", "registry": "7545" }
    }
  },
  "sites": { "dir": "dist" }
}
`,
  );

  saveConfig(loadConfig(path), path);

  const text = readFileSync(path, "utf-8");
  expect(text).toContain("// my deploy config");

  const parsed = JSON.parse(text.replace(/\/\/.*$/gm, "")) as Record<
    string,
    any
  >;
  expect(parsed.app.id).toBeUndefined();
  expect(parsed.app.containers.api.registry).toBeUndefined();
  expect(parsed.app.containers.api.dockerfile).toBe("Dockerfile");
  expect(parsed.sites).toEqual({ dir: "dist" });
});

describe("assertVolumesNotSplit", () => {
  const app = (
    regions: BunnyAppConfig["app"]["regions"],
    { volumes = true, max = 1 } = {},
  ): BunnyAppConfig => ({
    version: "2026-05-11",
    app: {
      name: "x",
      regions,
      scaling: { min: 1, max },
      containers: {
        web: {},
        db: volumes
          ? { volumes: [{ name: "data", mount: "/data", size: 1 }] }
          : {},
      },
    },
  });

  test("refuses a volume in more than one region, naming them", () => {
    expect(() => assertVolumesNotSplit(app(["de", "uk"]))).toThrow(
      'Container "db" mounts a volume, but the app runs in 2 regions (de, uk).',
    );
  });

  test("refuses a volume on more than one instance", () => {
    expect(() => assertVolumesNotSplit(app(["de"], { max: 3 }))).toThrow(
      'Container "db" mounts a volume, but the app scales to 3 instances.',
    );
  });

  test("names both when regions and scaling split it", () => {
    expect(() => assertVolumesNotSplit(app(["de", "uk"], { max: 2 }))).toThrow(
      "runs in 2 regions (de, uk) and scales to 2 instances.",
    );
  });

  test("counts the regions an app may run in, not just the required ones", () => {
    expect(() =>
      assertVolumesNotSplit(app({ allowed: ["de", "uk"], required: ["de"] })),
    ).toThrow();
  });

  test.each([
    ["one region and one instance", app(["de"])],
    ["no volume", app(["de", "uk"], { volumes: false, max: 3 })],
  ])("allows %s", (_, config) => {
    expect(() => assertVolumesNotSplit(config)).not.toThrow();
  });

  test("--allow-split-volumes opts in", () => {
    expect(() =>
      assertVolumesNotSplit(app(["de", "uk"], { max: 3 }), true),
    ).not.toThrow();
  });
});
