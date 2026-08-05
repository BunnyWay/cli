import { expect, test } from "bun:test";
import prompts from "prompts";
import { promptSiteName, suggestSiteName } from "./provision.ts";

test("promptSiteName normalizes and validates a passed name", async () => {
  expect(await promptSiteName("My-Site", false)).toBe("my-site");
  expect(await promptSiteName("  Blog  ", false)).toBe("blog");
});

test("promptSiteName rejects a missing name when non-interactive", async () => {
  await expect(promptSiteName(undefined, false)).rejects.toThrow(
    "Site name is required",
  );
});

test("promptSiteName rejects an invalid name", async () => {
  await expect(promptSiteName("Not A Name!", false)).rejects.toThrow(
    "not a valid site name",
  );
  await expect(promptSiteName("-leading", false)).rejects.toThrow(
    "not a valid site name",
  );
});

test("promptSiteName prompts when no name is passed and normalizes the answer", async () => {
  prompts.inject(["Prompted-Name"]);
  expect(await promptSiteName(undefined, true)).toBe("prompted-name");
});

test("suggestSiteName returns a slug or undefined, never an invalid name", () => {
  const suggestion = suggestSiteName();
  // Depending on the cwd it may be undefined; when present it must be usable.
  if (suggestion !== undefined) {
    expect(suggestion).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  }
});
