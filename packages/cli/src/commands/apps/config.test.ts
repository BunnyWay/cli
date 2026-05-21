import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../test-utils/temp-dir.ts";
import {
  configExists,
  loadConfig,
  saveConfig,
  stripTransientFields,
} from "./config.ts";

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

test("stripTransientFields removes image+registry when dockerfile is set", () => {
  const stripped = stripTransientFields({
    version: "2026-05-11",
    app: {
      name: "demo",
      containers: {
        api: {
          dockerfile: "Dockerfile",
          image: "ghcr.io/me/api:abc123",
          registry: "7545",
        },
      },
    },
  });

  expect(stripped.app.containers.api).toEqual({
    dockerfile: "Dockerfile",
  });
});

test("stripTransientFields keeps image, drops registry when dockerfile is absent", () => {
  const stripped = stripTransientFields({
    version: "2026-05-11",
    app: {
      name: "demo",
      containers: {
        api: { image: "nginx:1.27", registry: "7545" },
      },
    },
  });

  expect(stripped.app.containers.api).toEqual({
    image: "nginx:1.27",
  });
});

test("stripTransientFields removes app.id (it lives in .bunny/app.json)", () => {
  const stripped = stripTransientFields({
    version: "2026-05-11",
    app: {
      id: "app_abc123",
      name: "demo",
      containers: {},
    },
  });

  expect(stripped.app.id).toBeUndefined();
  expect(stripped.app.name).toBe("demo");
});

test("stripTransientFields handles mixed containers in one app", () => {
  const stripped = stripTransientFields({
    version: "2026-05-11",
    app: {
      name: "stack",
      containers: {
        web: {
          dockerfile: "Dockerfile",
          image: "ghcr.io/me/web:abc",
          registry: "7545",
        },
        db: { image: "postgres:17-alpine", registry: "1155" },
      },
    },
  });

  expect(stripped.app.containers.web).toEqual({ dockerfile: "Dockerfile" });
  expect(stripped.app.containers.db).toEqual({ image: "postgres:17-alpine" });
});

test("saveConfig strips id/registry/transient-image on disk", () => {
  const path = join(tempDir(), "transient.jsonc");
  saveConfig(
    {
      version: "2026-05-11",
      app: {
        id: "app_abc123",
        name: "demo",
        containers: {
          api: {
            dockerfile: "Dockerfile",
            image: "ghcr.io/me/api:abc123",
            registry: "7545",
          },
        },
      },
    },
    path,
  );

  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  expect(parsed.app.containers.api.dockerfile).toBe("Dockerfile");
  expect(parsed.app.containers.api.registry).toBeUndefined();
  expect(parsed.app.containers.api.image).toBeUndefined();
  expect(parsed.app.id).toBeUndefined();
});

test("load → save → reload preserves intent fields", () => {
  const path = join(tempDir(), "rt.jsonc");
  writeFileSync(
    path,
    JSON.stringify({
      version: "2026-05-11",
      app: {
        name: "rt",
        scaling: { min: 2, max: 5 },
        containers: {
          api: { image: "nginx", command: ["nginx", "-g", "daemon off;"] },
        },
      },
    }),
  );
  const original = loadConfig(path);
  // app.id mutations on the in-memory object are NOT round-tripped
  // through the file - identity lives in .bunny/app.json now.
  original.app.id = "app_abc123";
  saveConfig(original, path);

  const reloaded = loadConfig(path);
  expect(reloaded.app.id).toBeUndefined();
  expect(reloaded.app.name).toBe("rt");
  expect(reloaded.app.scaling).toEqual({ min: 2, max: 5 });
  expect(reloaded.app.containers.api?.image).toBe("nginx");
  expect(reloaded.app.containers.api?.command).toEqual([
    "nginx",
    "-g",
    "daemon off;",
  ]);
});
