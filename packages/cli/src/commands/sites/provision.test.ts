import { expect, test } from "bun:test";
import prompts from "prompts";
import { toStorageRegionOption } from "@/tools/storage/index.ts";
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

test("resolveSiteRegion rejects a region the tier cannot use", () => {
  const catalog = [
    toStorageRegionOption({ Code: "DE", Tier: 1, IsMainRegionSupported: true }),
    toStorageRegionOption({ Code: "NY", Tier: 1 }),
  ];
  expect(resolveSiteRegion(catalog, undefined, "ssd")).toBeUndefined();
  expect(resolveSiteRegion(catalog, "de", "ssd")).toBe("DE");
  expect(() => resolveSiteRegion(catalog, "NY", "ssd")).toThrow(
    "NY cannot be the storage region of Edge (SSD) sites",
  );
});
