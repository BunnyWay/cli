import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  augmentProjectConfig,
  loadProjectConfig,
  projectConfigTemplate,
  removeBinding,
  upsertBinding,
} from "./project-config.ts";

function tempConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bunny-project-"));
  const path = join(dir, "bunny.jsonc");
  writeFileSync(path, content);
  return path;
}

describe("projectConfigTemplate", () => {
  test("produces a loadable config with comments", () => {
    const path = tempConfig(projectConfigTemplate("acme"));
    const config = loadProjectConfig(path);
    expect(config.name).toBe("acme");
    expect(config.databases).toEqual({});
    expect(config.scripts).toEqual({});
  });
});

describe("loadProjectConfig", () => {
  test("throws with per-field issues for invalid configs", () => {
    const path = tempConfig(`{ "version": "nope", "name": "x" }`);
    expect(() => loadProjectConfig(path)).toThrow(/version/);
  });

  test("throws a helpful error when the file is missing", () => {
    expect(() => loadProjectConfig("/nonexistent/bunny.jsonc")).toThrow(
      /No project config found/,
    );
  });

  test("accepts an apps-only bunny.jsonc", () => {
    const path = tempConfig(
      `{
  // existing apps config
  "version": "2026-05-11",
  "app": { "name": "demo", "containers": { "api": { "image": "nginx" } } }
}`,
    );
    const config = loadProjectConfig(path);
    expect(config.app?.name).toBe("demo");
    expect(config.databases).toBeUndefined();
  });
});

describe("augmentProjectConfig", () => {
  test("adds project keys to an apps-only file, preserving the app block and comments", () => {
    const path = tempConfig(
      `{
  // hand-written apps config
  "$schema": "./node_modules/@bunny.net/app-config/generated/schema.json",
  "version": "2026-05-11",
  "app": { "name": "demo", "containers": { "api": { "image": "nginx" } } }
}`,
    );

    augmentProjectConfig("acme", path);

    const config = loadProjectConfig(path);
    expect(config.name).toBe("acme");
    expect(config.databases).toEqual({});
    expect(config.scripts).toEqual({});
    expect(config.app?.containers.api?.image).toBe("nginx");

    const text = readFileSync(path, "utf-8");
    expect(text).toContain("// hand-written apps config");
    expect(text).toContain("@bunny.net/project-config/generated/schema.json");
  });

  test("leaves existing name and maps alone", () => {
    const path = tempConfig(projectConfigTemplate("keep-me"));
    upsertBinding("databases", "db", { id: "db_1" }, path);

    augmentProjectConfig("other-name", path);

    const config = loadProjectConfig(path);
    expect(config.name).toBe("keep-me");
    expect(config.databases?.db?.id).toBe("db_1");
  });
});

describe("upsertBinding / removeBinding", () => {
  test("adds, replaces, and removes bindings while preserving comments", () => {
    const path = tempConfig(projectConfigTemplate("acme"));

    upsertBinding("databases", "db", { id: "db_1", name: "acme-db" }, path);
    expect(loadProjectConfig(path).databases?.db?.id).toBe("db_1");

    upsertBinding("databases", "db", { id: "db_2" }, path);
    upsertBinding("scripts", "api", { id: 7, type: "standalone" }, path);
    const config = loadProjectConfig(path);
    expect(config.databases?.db).toEqual({ id: "db_2" });
    expect(config.scripts?.api).toEqual({ id: 7, type: "standalone" });

    removeBinding("databases", "db", path);
    expect(loadProjectConfig(path).databases).toEqual({});

    const text = readFileSync(path, "utf-8");
    expect(text).toContain("// Maps this project to the bunny.net resources");
    expect(text).toContain("// Databases this project uses");
  });
});
