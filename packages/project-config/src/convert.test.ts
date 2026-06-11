import { describe, expect, test } from "bun:test";
import {
  databaseToBinding,
  emptyProjectConfig,
  scriptToBinding,
  suggestBindingName,
} from "./convert.ts";
import { BunnyProjectConfigSchema } from "./schema.ts";

describe("emptyProjectConfig", () => {
  test("produces a schema-valid config", () => {
    const config = emptyProjectConfig("acme");
    expect(() => BunnyProjectConfigSchema.parse(config)).not.toThrow();
    expect(config.name).toBe("acme");
  });
});

describe("databaseToBinding", () => {
  test("maps id and name", () => {
    expect(databaseToBinding({ id: "db_123", name: "acme-db" })).toEqual({
      id: "db_123",
      name: "acme-db",
    });
  });
});

describe("scriptToBinding", () => {
  test("maps id, name, and type label", () => {
    expect(scriptToBinding({ Id: 42, Name: "api", ScriptType: 1 })).toEqual({
      id: 42,
      name: "api",
      type: "standalone",
    });
    expect(scriptToBinding({ Id: 7, ScriptType: 2 }).type).toBe("middleware");
  });

  test("omits type for unknown script types", () => {
    expect(scriptToBinding({ Id: 1 }).type).toBeUndefined();
  });

  test("throws without an Id", () => {
    expect(() => scriptToBinding({ Name: "x" })).toThrow();
  });
});

describe("suggestBindingName", () => {
  test("slugifies resource names", () => {
    expect(suggestBindingName("My API!")).toBe("my-api");
    expect(suggestBindingName("acme_db")).toBe("acme_db");
    expect(suggestBindingName("42 things")).toBe("things");
  });

  test("falls back when nothing usable remains", () => {
    expect(suggestBindingName("!!!")).toBe("resource");
  });
});
