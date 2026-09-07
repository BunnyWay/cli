import { expect, test } from "bun:test";
import { resolutionRows } from "./resolutions.ts";

test("resolutionRows builds a matrix across every list the API reports", () => {
  expect(
    resolutionRows({
      configuredResolutions: ["720p", "1080p"],
      availableResolutions: ["720p"],
      playlistResolutions: [{ resolution: "720p", path: "/720p" }],
      storageResolutions: [{ resolution: "720p", path: "/720p" }],
      mp4Resolutions: [],
    }),
  ).toEqual([
    ["720p", "yes", "yes", "yes", "yes", "-"],
    ["1080p", "yes", "-", "-", "-", "-"],
  ]);
});

test("resolutionRows sorts numerically, not as strings", () => {
  const rows = resolutionRows({
    configuredResolutions: ["1080p", "240p", "720p", "2160p", "360p"],
  });
  expect(rows.map((row) => row[0])).toEqual([
    "240p",
    "360p",
    "720p",
    "1080p",
    "2160p",
  ]);
});

test("resolutionRows is empty when the video has no resolutions at all", () => {
  expect(resolutionRows({})).toEqual([]);
  expect(resolutionRows({ availableResolutions: [] })).toEqual([]);
});

// A resolution that only exists in storage still has to show up.
test("resolutionRows includes resolutions missing from the configured list", () => {
  expect(
    resolutionRows({
      configuredResolutions: [],
      storageResolutions: [{ resolution: "480p", path: "/480p" }],
    }),
  ).toEqual([["480p", "-", "-", "-", "yes", "-"]]);
});
