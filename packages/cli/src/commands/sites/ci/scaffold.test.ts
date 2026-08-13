import { expect, test } from "bun:test";
import { projectPrefix } from "./scaffold.ts";

test("projectPrefix is empty when the project is the workflow root", () => {
  expect(projectPrefix("/repo", "/repo")).toBe("");
  expect(projectPrefix("/repo", undefined)).toBe("");
});

test("projectPrefix returns the POSIX offset for a nested project", () => {
  expect(projectPrefix("/repo", "/repo/packages/site")).toBe("packages/site");
});

// A bunny.jsonc above the git root can't be referenced from a repo-rooted workflow.
test("projectPrefix is undefined when the project escapes the workflow root", () => {
  expect(projectPrefix("/repo/app", "/repo")).toBeUndefined();
});
