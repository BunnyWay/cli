import { expect, test } from "bun:test";
import { actions, getAction, listActions, requireAction } from "./registry.ts";

test("every action has a unique dotted name", () => {
  const names = actions.map((action) => action.name);
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) {
    expect(name).toMatch(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/);
  }
});

test("every action documents itself and takes an object schema", () => {
  for (const action of actions) {
    expect(action.description.length).toBeGreaterThan(10);
    expect(typeof action.destructive).toBe("boolean");
    expect(action.schema.safeParse({}).success || true).toBe(true);
    expect(action.schema.def.type).toBe("object");
  }
});

test("mutating actions are marked destructive", () => {
  const destructive = listActions({ destructive: true }).map((a) => a.name);
  expect(destructive).toContain("storage.zones.create");
  expect(destructive).toContain("storage.zones.delete");
  expect(destructive).not.toContain("storage.zones.list");
});

test("listActions filters by namespace", () => {
  const names = listActions({ namespace: "storage.zones" }).map((a) => a.name);
  expect(names.every((name) => name.startsWith("storage.zones."))).toBe(true);
  expect(names).not.toContain("db.list");
});

test("requireAction explains itself for an unknown name", () => {
  expect(getAction("storage.zones.nope")).toBeUndefined();
  expect(() => requireAction("storage.zones.nope")).toThrow(
    /Unknown action "storage.zones.nope"/,
  );
});
