import { expect, test } from "bun:test";
import { actions, getAction } from "./registry.ts";
import {
  describeAction,
  flatName,
  inputJsonSchema,
  outputJsonSchema,
  toStructuredResult,
} from "./schema.ts";

test("every action has an object input schema", () => {
  for (const action of actions) {
    const schema = inputJsonSchema(action);
    expect(schema.type).toBe("object");
  }
});

test("input schemas carry field descriptions and reject unknown keys", () => {
  const schema = inputJsonSchema(getAction("storage.zones.get")!) as {
    properties: Record<string, { description?: string }>;
    required: string[];
    additionalProperties: boolean;
  };
  expect(schema.properties.zone?.description).toContain("name or numeric ID");
  expect(schema.required).toEqual(["zone"]);
  expect(schema.additionalProperties).toBe(false);
});

test("region choices reach the schema as an enum", () => {
  const schema = inputJsonSchema(getAction("storage.zones.create")!) as {
    properties: { region: { enum: string[] } };
  };
  expect(schema.properties.region.enum).toContain("DE");
});

test("object results pass through, array results are wrapped", () => {
  const get = outputJsonSchema(getAction("storage.zones.get")!);
  expect(get?.type).toBe("object");
  expect(get?.properties).toHaveProperty("replicationRegions");

  const list = outputJsonSchema(getAction("storage.zones.list")!);
  expect(list?.type).toBe("object");
  const wrapped = list?.properties as { result: { type: string } };
  expect(wrapped.result.type).toBe("array");
});

test("toStructuredResult mirrors the output schema wrapping", () => {
  const get = getAction("storage.zones.get")!;
  expect(toStructuredResult(get, { id: 1 })).toEqual({ id: 1 });

  const list = getAction("storage.zones.list")!;
  expect(toStructuredResult(list, [{ id: 1 }])).toEqual({
    result: [{ id: 1 }],
  });
});

test("sensitive and localFiles surface in the description", () => {
  expect(describeAction(getAction("storage.zones.credentials")!)).toContain(
    "Treat it as a secret",
  );
  expect(describeAction(getAction("storage.files.upload")!)).toContain(
    "local filesystem",
  );
});

test("flatName is unique across the registry and prefixes cleanly", () => {
  const flat = actions.map((action) => flatName(action, "bunny"));
  expect(new Set(flat).size).toBe(actions.length);
  for (const name of flat) {
    expect(name).toMatch(/^[a-z0-9_]+$/);
  }
  expect(flatName(getAction("storage.zones.list")!)).toBe("storage_zones_list");
});
