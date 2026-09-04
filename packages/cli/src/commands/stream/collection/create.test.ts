import { expect, test } from "bun:test";
import { collectionName } from "./create.ts";

test("the positional and --name are interchangeable", () => {
  expect(collectionName("Tutorials", undefined)).toBe("Tutorials");
  expect(collectionName(undefined, "Tutorials")).toBe("Tutorials");
  expect(collectionName("Tutorials", " Tutorials ")).toBe("Tutorials");
});

test("conflicting names are an error", () => {
  expect(() => collectionName("one", "two")).toThrow(/Conflicting names/);
});

test("whitespace-only input counts as absent", () => {
  expect(collectionName("  ", undefined)).toBeUndefined();
  expect(collectionName(undefined, undefined)).toBeUndefined();
});
