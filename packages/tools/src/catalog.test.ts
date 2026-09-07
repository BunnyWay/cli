import { expect, test } from "bun:test";
import { getTool, listTools, requireTool, tools } from "./catalog.ts";

test("every tool has a unique dotted name, a description, an object schema, and a result schema", () => {
  const names = tools.map((tool) => tool.name);
  expect(new Set(names).size).toBe(names.length);
  for (const tool of tools) {
    expect(tool.name).toMatch(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/);
    expect(tool.description.length).toBeGreaterThan(10);
    expect(tool.schema.def.type).toBe("object");
    expect(tool.resultSchema).toBeDefined();
  }
});

test("listTools filters by kind and namespace", () => {
  const destructive = listTools({ kind: "destructive" }).map((t) => t.name);
  expect(destructive).toEqual(["registries.delete"]);
  expect(listTools({ kind: "read" }).map((t) => t.name)).toContain(
    "registries.list",
  );
  expect(
    listTools({ namespace: "registries" }).every((t) =>
      t.name.startsWith("registries."),
    ),
  ).toBe(true);
  expect(listTools({ namespace: "nope" })).toEqual([]);
});

test("requireTool explains itself for an unknown name", () => {
  expect(getTool("registries.nope")).toBeUndefined();
  expect(() => requireTool("registries.nope")).toThrow(
    /Unknown tool "registries.nope"/,
  );
});
