import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { useTempDir } from "../../../test-utils/temp-dir.ts";
import type { ComposeFile } from "./schema.ts";
import { composeToConfig } from "./translate.ts";

const tempDir = useTempDir("bunny-compose-");

function callTranslate(file: ComposeFile, overrideOpts?: object) {
  return composeToConfig(file, {
    composeFilePath: join(tempDir(), "compose.yml"),
    appName: "myapp",
    regions: ["sfo"],
    defaultRegistryId: "12345",
    ...overrideOpts,
  });
}

describe("composeToConfig", () => {
  test("single image-only service", () => {
    const result = callTranslate({
      services: { api: { image: "nginx:1.27" } },
    });
    expect(result.config.app.containers).toEqual({
      api: { image: "nginx:1.27", registry: "12345" },
    });
    expect(result.warnings).toEqual([]);
  });

  test("service with string build form", () => {
    const result = callTranslate({
      services: { api: { build: "." } },
    });
    expect(result.config.app.containers.api).toMatchObject({
      context: ".",
      dockerfile: "Dockerfile",
      registry: "12345",
    });
  });

  test("service with object build form", () => {
    const result = callTranslate({
      services: {
        api: {
          build: { context: "./api", dockerfile: "Dockerfile.prod" },
        },
      },
    });
    expect(result.config.app.containers.api).toMatchObject({
      context: "./api",
      dockerfile: "Dockerfile.prod",
    });
  });

  test("service with neither image nor build throws", () => {
    expect(() =>
      callTranslate({
        services: { api: {} },
      }),
    ).toThrow(/has neither `image` nor `build`/);
  });

  test("environment as map → container.env", () => {
    const result = callTranslate({
      services: {
        api: {
          image: "x",
          environment: { PORT: "3000", DEBUG: true, FOO: 42 },
        },
      },
    });
    expect(result.config.app.containers.api?.env).toEqual({
      PORT: "3000",
      DEBUG: "true",
      FOO: "42",
    });
  });

  test("environment as array → container.env", () => {
    const result = callTranslate({
      services: {
        api: { image: "x", environment: ["KEY=value", "OTHER=2"] },
      },
    });
    expect(result.config.app.containers.api?.env).toEqual({
      KEY: "value",
      OTHER: "2",
    });
  });

  test("env_file keys become pointers; environment literals override", () => {
    // env_file values stay in .env (gitignored). bunny.jsonc only carries
    // the *keys* as pointers ("K": "K") that get resolved at deploy time.
    // environment: literals copy as-is and win over env_file pointers.
    writeFileSync(join(tempDir(), "shared.env"), "PORT=3000\nDB_URL=local\n");
    const result = callTranslate({
      services: {
        api: {
          image: "x",
          env_file: "shared.env",
          environment: { DB_URL: "prod" },
        },
      },
    });
    expect(result.config.app.containers.api?.env).toEqual({
      PORT: "PORT",
      DB_URL: "prod",
    });
  });

  test("env_file missing file throws", () => {
    expect(() =>
      callTranslate({
        services: { api: { image: "x", env_file: "missing.env" } },
      }),
    ).toThrow(/env_file.*not found/);
  });

  test("ports → one CDN endpoint with multiple mappings", () => {
    const result = callTranslate({
      services: {
        api: { image: "x", ports: ["3000:80", "9229:9229"] },
      },
    });
    const endpoints = result.config.app.containers.api?.endpoints;
    expect(endpoints).toHaveLength(1);
    expect(endpoints?.[0]).toMatchObject({
      type: "cdn",
      ssl: true,
      ports: [
        { public: 3000, container: 80 },
        { public: 9229, container: 9229 },
      ],
    });
  });

  test("command (string) splits on whitespace", () => {
    const result = callTranslate({
      services: { api: { image: "x", command: "node ./server.js --port 80" } },
    });
    expect(result.config.app.containers.api?.command).toEqual([
      "node",
      "./server.js",
      "--port",
      "80",
    ]);
  });

  test("command (array) passes through", () => {
    const result = callTranslate({
      services: { api: { image: "x", command: ["node", "server.js"] } },
    });
    expect(result.config.app.containers.api?.command).toEqual([
      "node",
      "server.js",
    ]);
  });

  test("named volume → container.volumes with default size", () => {
    const result = callTranslate({
      services: {
        api: { image: "x", volumes: ["data:/var/lib/data"] },
      },
      volumes: { data: {} },
    });
    expect(result.config.app.containers.api?.volumes).toEqual([
      { name: "data", mount: "/var/lib/data", size: 1 },
    ]);
  });

  test("bind mount (string form) throws", () => {
    expect(() =>
      callTranslate({
        services: { api: { image: "x", volumes: ["./src:/app/src"] } },
      }),
    ).toThrow(/bind mount/);
  });

  test("bind mount (object form) throws", () => {
    expect(() =>
      callTranslate({
        services: {
          api: {
            image: "x",
            volumes: [{ type: "bind", source: "/host", target: "/c" }],
          },
        },
      }),
    ).toThrow(/bind mount/);
  });

  test("anonymous volume (single segment) throws", () => {
    expect(() =>
      callTranslate({
        services: { api: { image: "x", volumes: ["/data"] } },
      }),
    ).toThrow(/anonymous volume/);
  });

  test("healthcheck with HTTP URL → http probe with path", () => {
    const result = callTranslate({
      services: {
        api: {
          image: "x",
          healthcheck: {
            test: ["CMD", "curl", "-f", "http://localhost:3000/health"],
          },
        },
      },
    });
    expect(result.config.app.containers.api?.probes?.liveness).toEqual({
      type: "http",
      path: "/health",
      port: 3000,
    });
  });

  test("healthcheck without URL falls back to tcp probe", () => {
    const result = callTranslate({
      services: {
        api: {
          image: "x",
          healthcheck: { test: ["CMD", "pg_isready", "-U", "postgres"] },
        },
      },
    });
    expect(result.config.app.containers.api?.probes?.liveness).toEqual({
      type: "tcp",
    });
  });

  test("depends_on and networks emit warnings, not errors", () => {
    const result = callTranslate({
      services: {
        api: {
          image: "x",
          depends_on: ["db"],
          networks: ["app"],
        },
        db: { image: "postgres" },
      },
    });
    expect(result.warnings.some((w) => w.includes("depends_on"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("networks"))).toBe(true);
    expect(result.config.app.containers.api?.image).toBe("x");
  });

  test("extends throws (hard refused)", () => {
    expect(() =>
      callTranslate({
        services: { api: { image: "x", extends: { service: "base" } } },
      }),
    ).toThrow(/extends/);
  });

  test("secrets throws", () => {
    expect(() =>
      callTranslate({
        services: { api: { image: "x", secrets: ["db-password"] } },
      }),
    ).toThrow(/secrets/);
  });

  test("multi-service translates every entry", () => {
    const result = callTranslate({
      services: {
        api: { image: "ghcr.io/me/api:v1", ports: ["3000:3000"] },
        db: { image: "postgres:16", volumes: ["pgdata:/var/lib/postgresql"] },
        redis: { image: "redis:7" },
      },
      volumes: { pgdata: {} },
    });
    expect(Object.keys(result.config.app.containers)).toEqual([
      "api",
      "db",
      "redis",
    ]);
    expect(result.config.app.containers.api?.endpoints).toHaveLength(1);
    expect(result.config.app.containers.db?.volumes).toHaveLength(1);
    expect(result.config.app.containers.redis?.image).toBe("redis:7");
  });

  test("empty services throws", () => {
    expect(() => callTranslate({ services: {} })).toThrow(/no services/i);
  });
});
