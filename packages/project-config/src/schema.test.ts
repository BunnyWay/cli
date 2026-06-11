import { describe, expect, test } from "bun:test";
import { BunnyProjectConfigSchema, CURRENT_VERSION } from "./schema.ts";

const valid = {
  version: CURRENT_VERSION,
  name: "acme-storefront",
  databases: {
    db: { id: "db_01KCHBG8C5KSFGG0VRNFQ7EK7X", name: "acme-db" },
  },
  scripts: {
    api: {
      id: 1234,
      name: "acme-api",
      type: "standalone",
      entry: "src/index.ts",
    },
  },
};

describe("BunnyProjectConfigSchema", () => {
  test("parses a full config", () => {
    const parsed = BunnyProjectConfigSchema.parse(valid);
    expect(parsed.name).toBe("acme-storefront");
    expect(parsed.databases?.db?.id).toBe("db_01KCHBG8C5KSFGG0VRNFQ7EK7X");
    expect(parsed.scripts?.api?.type).toBe("standalone");
  });

  test("parses a minimal config (resource maps optional)", () => {
    const parsed = BunnyProjectConfigSchema.parse({
      version: CURRENT_VERSION,
      name: "bare",
    });
    expect(parsed.databases).toBeUndefined();
    expect(parsed.scripts).toBeUndefined();
  });

  test("accepts $schema for editor integration", () => {
    expect(() =>
      BunnyProjectConfigSchema.parse({
        ...valid,
        $schema:
          "./node_modules/@bunny.net/project-config/generated/schema.json",
      }),
    ).not.toThrow();
  });

  test("rejects a non-date version", () => {
    expect(() =>
      BunnyProjectConfigSchema.parse({ ...valid, version: "v1" }),
    ).toThrow();
  });

  test("accepts an apps-only bunny.jsonc (no name, app block present)", () => {
    const parsed = BunnyProjectConfigSchema.parse({
      version: "2026-05-11",
      app: { name: "demo", containers: { api: { image: "nginx" } } },
    });
    expect(parsed.name).toBeUndefined();
    expect(parsed.app?.name).toBe("demo");
  });

  test("rejects an invalid app block", () => {
    expect(() =>
      BunnyProjectConfigSchema.parse({
        version: CURRENT_VERSION,
        app: { containers: {} },
      }),
    ).toThrow();
  });

  test("rejects invalid binding names", () => {
    expect(() =>
      BunnyProjectConfigSchema.parse({
        ...valid,
        databases: { "9lives": { id: "x" } },
      }),
    ).toThrow();
    expect(() =>
      BunnyProjectConfigSchema.parse({
        ...valid,
        scripts: { "has space": { id: 1 } },
      }),
    ).toThrow();
  });

  test("rejects unknown script types", () => {
    expect(() =>
      BunnyProjectConfigSchema.parse({
        ...valid,
        scripts: { api: { id: 1, type: "worker" } },
      }),
    ).toThrow();
  });
});
