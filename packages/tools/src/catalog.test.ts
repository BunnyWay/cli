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
  expect(destructive).toEqual(["apps.registries.delete"]);
  expect(listTools({ kind: "read" }).map((t) => t.name)).toContain(
    "apps.registries.list",
  );
  // A dotted namespace narrows within a product area, so `apps` and `apps.registries` both filter.
  expect(
    listTools({ namespace: "apps" }).every((t) => t.name.startsWith("apps.")),
  ).toBe(true);
  expect(listTools({ namespace: "apps.registries" }).length).toBe(
    listTools({ namespace: "apps" }).length,
  );
  expect(listTools({ namespace: "nope" })).toEqual([]);
});

test("requireTool explains itself for an unknown name", () => {
  expect(getTool("apps.registries.nope")).toBeUndefined();
  expect(() => requireTool("apps.registries.nope")).toThrow(
    /Unknown tool "apps.registries.nope"/,
  );
});
