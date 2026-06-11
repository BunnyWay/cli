import { describe, expect, test } from "bun:test";
import { BunnyProjectConfigSchema } from "./schema.ts";
import { toJSONSchema } from "./standard-json-schema.ts";

describe("toJSONSchema", () => {
  test("converts via the ~standard.jsonSchema interface", () => {
    const schema = toJSONSchema(BunnyProjectConfigSchema, {
      target: "draft-2020-12",
    });
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
  });

  test("binding name validation survives as propertyNames", () => {
    const schema = toJSONSchema(BunnyProjectConfigSchema) as {
      properties: { databases: { propertyNames: { pattern: string } } };
    };
    expect(schema.properties.databases.propertyNames.pattern).toContain(
      "A-Za-z",
    );
  });

  test("throws for vendors without Standard JSON Schema support", () => {
    const fake = { "~standard": { version: 1 as const, vendor: "fake" } };
    expect(() => toJSONSchema(fake)).toThrow(/fake/);
  });
});
