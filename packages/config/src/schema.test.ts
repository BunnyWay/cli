import { describe, expect, test } from "bun:test";
import {
  BunnyAppConfigSchema,
  ContainerConfigSchema,
  CURRENT_VERSION,
  normalizeRegions,
} from "./schema.ts";

function valid<T extends Record<string, unknown>>(overrides: T = {} as T) {
  return {
    version: CURRENT_VERSION,
    app: {
      name: "my-app",
      containers: { api: { image: "nginx" } },
    },
    ...overrides,
  };
}

describe("BunnyAppConfigSchema", () => {
  test("minimal valid config parses", () => {
    const result = BunnyAppConfigSchema.safeParse(valid());
    expect(result.success).toBe(true);
  });

  test("missing version is rejected", () => {
    const result = BunnyAppConfigSchema.safeParse({
      app: { name: "x", containers: { api: {} } },
    });
    expect(result.success).toBe(false);
  });

  test("non-padded version is rejected", () => {
    const result = BunnyAppConfigSchema.safeParse({
      ...valid(),
      version: "2026-1-1",
    });
    expect(result.success).toBe(false);
  });

  test("non-date-string version is rejected", () => {
    const result = BunnyAppConfigSchema.safeParse({
      ...valid(),
      version: "v1",
    });
    expect(result.success).toBe(false);
  });

  test("numeric version is rejected", () => {
    const result = BunnyAppConfigSchema.safeParse({
      ...valid(),
      version: 20260511,
    });
    expect(result.success).toBe(false);
  });

  test("missing app.name is rejected", () => {
    const result = BunnyAppConfigSchema.safeParse({
      version: CURRENT_VERSION,
      app: { containers: { api: {} } },
    });
    expect(result.success).toBe(false);
  });

  test("missing app.containers is rejected", () => {
    const result = BunnyAppConfigSchema.safeParse({
      version: CURRENT_VERSION,
      app: { name: "x" },
    });
    expect(result.success).toBe(false);
  });

  test("$schema is preserved when present", () => {
    const result = BunnyAppConfigSchema.safeParse({
      ...valid(),
      $schema: "https://example.com/schema.json",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.$schema).toBe("https://example.com/schema.json");
    }
  });

  test("app.id is optional", () => {
    const withId = BunnyAppConfigSchema.safeParse({
      version: CURRENT_VERSION,
      app: { id: "app_42", name: "x", containers: { api: {} } },
    });
    const withoutId = BunnyAppConfigSchema.safeParse(valid());
    expect(withId.success).toBe(true);
    expect(withoutId.success).toBe(true);
  });
});

describe("regions field", () => {
  test("array form parses", () => {
    const result = BunnyAppConfigSchema.safeParse({
      ...valid(),
      app: { ...valid().app, regions: ["sfo", "lhr"] },
    });
    expect(result.success).toBe(true);
  });

  test("object form parses", () => {
    const result = BunnyAppConfigSchema.safeParse({
      ...valid(),
      app: {
        ...valid().app,
        regions: { allowed: ["sfo", "lhr"], required: ["sfo"] },
      },
    });
    expect(result.success).toBe(true);
  });

  test("empty object form parses (both subfields optional)", () => {
    const result = BunnyAppConfigSchema.safeParse({
      ...valid(),
      app: { ...valid().app, regions: {} },
    });
    expect(result.success).toBe(true);
  });

  test("string instead of array/object is rejected", () => {
    const result = BunnyAppConfigSchema.safeParse({
      ...valid(),
      app: { ...valid().app, regions: "sfo" },
    });
    expect(result.success).toBe(false);
  });

  test("array of non-strings is rejected", () => {
    const result = BunnyAppConfigSchema.safeParse({
      ...valid(),
      app: { ...valid().app, regions: [1, 2] },
    });
    expect(result.success).toBe(false);
  });
});

describe("ContainerConfigSchema", () => {
  test("empty container parses", () => {
    expect(ContainerConfigSchema.safeParse({}).success).toBe(true);
  });

  test("container with every optional field parses", () => {
    const result = ContainerConfigSchema.safeParse({
      image: "ghcr.io/me/api:v1",
      dockerfile: "Dockerfile",
      context: ".",
      command: ["bash", "-c", "/start"],
      registry: "12345",
      env: { PORT: "3000" },
      probes: {
        readiness: { type: "http", path: "/healthz", port: 3000 },
        liveness: { type: "tcp", port: 3000 },
      },
      endpoints: [
        {
          type: "cdn",
          ssl: true,
          ports: [{ public: 443, container: 3000 }],
        },
      ],
      volumes: [{ name: "data", mount: "/data", size: 10 }],
    });
    expect(result.success).toBe(true);
  });

  test("invalid endpoint type is rejected", () => {
    const result = ContainerConfigSchema.safeParse({
      endpoints: [{ type: "tcp" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("normalizeRegions", () => {
  test("undefined yields empty arrays", () => {
    expect(normalizeRegions(undefined)).toEqual({
      allowed: [],
      required: [],
    });
  });

  test("array form fills both subfields with the same list", () => {
    expect(normalizeRegions(["sfo", "lhr"])).toEqual({
      allowed: ["sfo", "lhr"],
      required: ["sfo", "lhr"],
    });
  });

  test("object form with only allowed defaults required to []", () => {
    expect(normalizeRegions({ allowed: ["sfo"] })).toEqual({
      allowed: ["sfo"],
      required: [],
    });
  });

  test("object form with only required defaults allowed to []", () => {
    expect(normalizeRegions({ required: ["sfo"] })).toEqual({
      allowed: [],
      required: ["sfo"],
    });
  });

  test("empty object yields empty arrays", () => {
    expect(normalizeRegions({})).toEqual({ allowed: [], required: [] });
  });

  test("array result doesn't share references with input (defensive copy)", () => {
    const input = ["sfo", "lhr"];
    const result = normalizeRegions(input);
    result.allowed.push("nyc");
    expect(input).toEqual(["sfo", "lhr"]);
    expect(result.allowed).not.toBe(result.required);
  });
});

describe("CURRENT_VERSION", () => {
  test("matches the schema's version regex (no typos in the constant)", () => {
    const result = BunnyAppConfigSchema.safeParse(valid());
    expect(result.success).toBe(true);
  });
});
