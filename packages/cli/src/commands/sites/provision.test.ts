import { expect, test } from "bun:test";
import prompts from "prompts";
import { promptSiteName, resolveSiteRegion } from "./provision.ts";

test("promptSiteName normalizes and validates a passed name", async () => {
  expect(await promptSiteName("My-Site", false)).toBe("my-site");
  expect(await promptSiteName("  Blog  ", false)).toBe("blog");
});

test("promptSiteName rejects a missing name when non-interactive, and an invalid one", async () => {
  await expect(promptSiteName(undefined, false)).rejects.toThrow(
    "Site name is required",
  );
  await expect(promptSiteName("Not A Name!", false)).rejects.toThrow(
    "not a valid site name",
  );
});

test("promptSiteName prompts when no name is passed and normalizes the answer", async () => {
  prompts.inject(["Prompted-Name"]);
  expect(await promptSiteName(undefined, true)).toBe("prompted-name");
});

test("resolveSiteRegion pins the Edge (SSD) tier to DE", () => {
  expect(resolveSiteRegion(undefined, "ssd")).toBeUndefined();
  expect(resolveSiteRegion("de", "ssd")).toBe("DE");
  expect(() => resolveSiteRegion("NY", "ssd")).toThrow(
    "only available with DE",
  );
});
