import { expect, test } from "bun:test";
import { createLibraryName } from "./create.ts";

test("the positional and --name are interchangeable", () => {
  expect(createLibraryName("my-library", undefined)).toBe("my-library");
  expect(createLibraryName(undefined, "my-library")).toBe("my-library");
});

test("both forms are fine when they agree", () => {
  expect(createLibraryName("my-library", "  my-library ")).toBe("my-library");
});

// Silently picking a winner would create a library under a name the user did not expect.
test("conflicting names are an error", () => {
  expect(() => createLibraryName("one", "two")).toThrow(/Conflicting names/);
});

test("whitespace-only input counts as absent", () => {
  expect(createLibraryName("   ", undefined)).toBeUndefined();
  expect(createLibraryName(undefined, "  ")).toBeUndefined();
  expect(createLibraryName(undefined, undefined)).toBeUndefined();
});
