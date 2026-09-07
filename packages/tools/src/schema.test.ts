import { expect, test } from "bun:test";
import { requireTool, tools } from "./catalog.ts";
import {
  describeTool,
  flatName,
  inputJsonSchema,
  outputJsonSchema,
  toStructuredResult,
} from "./schema.ts";

test("input schemas carry field descriptions and reject unknown keys", () => {
  const schema = inputJsonSchema(requireTool("registries.get")) as {
    properties: Record<string, { description?: string }>;
    required: string[];
    additionalProperties: boolean;
  };
  expect(schema.properties.registry?.description).toContain("Registry ID");
  expect(schema.required).toEqual(["registry"]);
  expect(schema.additionalProperties).toBe(false);
});

test("object results pass through, array results are wrapped, and payloads match", () => {
  const get = requireTool("registries.get");
  expect(outputJsonSchema(get)?.properties).toHaveProperty("hostname");
  expect(toStructuredResult(get, { id: 1 })).toEqual({ id: 1 });

  const list = requireTool("registries.list");
  const wrapped = outputJsonSchema(list)?.properties as {
    result: { type: string };
  };
  expect(wrapped.result.type).toBe("array");
  expect(toStructuredResult(list, [{ id: 1 }])).toEqual({
    result: [{ id: 1 }],
  });
});

test("describeTool folds examples in and flatName is unique with a prefix", () => {
  expect(describeTool(requireTool("registries.delete"))).toContain(
    'Examples:\n- Remove a registry: {"registry":1155}',
  );
  const flat = tools.map((tool) => flatName(tool, "bunny"));
  expect(new Set(flat).size).toBe(tools.length);
  expect(flat).toContain("bunny_registries_list");
});
