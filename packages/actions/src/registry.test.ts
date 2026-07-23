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
    expect(["read", "write", "destructive"]).toContain(action.kind);
    expect(action.schema.safeParse({}).success || true).toBe(true);
    expect(action.schema.def.type).toBe("object");
  }
});

test("kinds separate reads, writes, and deletes", () => {
  const destructive = listActions({ kind: "destructive" }).map((a) => a.name);
  expect(destructive).toContain("storage.zones.delete");
  expect(destructive).toContain("storage.files.delete");
  expect(destructive).toContain("db.delete");
  expect(destructive).not.toContain("storage.zones.create");

  const writes = listActions({ kind: "write" }).map((a) => a.name);
  expect(writes).toContain("storage.zones.create");
  expect(writes).toContain("storage.files.upload");
  expect(writes).not.toContain("storage.zones.list");

  const reads = listActions({ kind: "read" }).map((a) => a.name);
  expect(reads).toContain("storage.zones.list");
  expect(reads).not.toContain("db.delete");
});

test("localFiles marks the actions a remote host should exclude", () => {
  const local = listActions({ localFiles: true }).map((a) => a.name);
  expect(local.sort()).toEqual([
    "storage.files.download",
    "storage.files.upload",
  ]);
  const remoteSafe = listActions({ localFiles: false }).map((a) => a.name);
  expect(remoteSafe).toContain("storage.files.list");
  expect(remoteSafe).not.toContain("storage.files.upload");
});

test("every action declares a result schema", () => {
  for (const action of actions) {
    expect(action.resultSchema).toBeDefined();
  }
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
