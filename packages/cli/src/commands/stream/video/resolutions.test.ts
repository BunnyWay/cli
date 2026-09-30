import { expect, test } from "bun:test";
import { resolutionRows } from "./resolutions.ts";

// A resolution that only exists in storage still has to show up.
test("resolutionRows has one row per resolution any list mentions", () => {
  expect(
    resolutionRows({
      configuredResolutions: ["720p"],
      availableResolutions: ["720p"],
      storageResolutions: [{ resolution: "480p", path: "/480p" }],
    }),
  ).toEqual([
    ["480p", "-", "-", "-", "yes", "-"],
    ["720p", "yes", "yes", "-", "-", "-"],
  ]);
});

test("resolutionRows sorts numerically, not as strings", () => {
  const rows = resolutionRows({
    configuredResolutions: ["1080p", "240p", "720p"],
  });
  expect(rows.map((row) => row[0])).toEqual(["240p", "720p", "1080p"]);
});
