import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../test-utils/temp-dir.ts";
import { configExists, loadConfig, saveConfig } from "./config.ts";

const tempDir = useTempDir("bunny-config-");

test("configExists(path) checks that exact file", () => {
  const path = join(tempDir(), "custom.jsonc");
  expect(configExists(path)).toBe(false);
  writeFileSync(
    path,
    JSON.stringify({
      version: "2026-05-11",
      app: { name: "x", containers: {} },
    }),
  );
  expect(configExists(path)).toBe(true);
});

test("loadConfig(path) reads from that exact file", () => {
  const path = join(tempDir(), "elsewhere.jsonc");
  writeFileSync(
    path,
    JSON.stringify({
      version: "2026-05-11",
      app: { name: "my-app", containers: { api: { image: "nginx" } } },
    }),
  );
  const cfg = loadConfig(path);
  expect(cfg.app.name).toBe("my-app");
  expect(cfg.app.containers.api?.image).toBe("nginx");
});

test("loadConfig(missing) throws", () => {
  expect(() => loadConfig(join(tempDir(), "nope.jsonc"))).toThrow(
    /No config file found/,
  );
});

test("saveConfig(data, path) writes there, not to cwd", () => {
  const path = join(tempDir(), "out.jsonc");
  saveConfig(
    {
      version: "2026-05-11",
      app: { name: "demo", containers: { api: { image: "x" } } },
    },
    path,
  );
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  expect(parsed.version).toBe("2026-05-11");
  expect(parsed.app.name).toBe("demo");
  expect(Object.keys(parsed)[0]).toBe("$schema");
});

test("load → save → reload round-trip through an explicit path", () => {
  const path = join(tempDir(), "rt.jsonc");
  writeFileSync(
    path,
    JSON.stringify({
      version: "2026-05-11",
      app: { name: "rt", containers: { api: { image: "nginx" } } },
    }),
  );
  const original = loadConfig(path);
  original.app.id = "app_abc123";
  saveConfig(original, path);
  expect(loadConfig(path).app.id).toBe("app_abc123");
});
