import { expect, test } from "bun:test";
import type { VideoResolutionsInfoModel } from "@/commands/stream/videos-api.ts";
import {
  cleanupItemLabel,
  cleanupPlan,
  informativeMessage,
} from "./cleanup-plan.ts";

const INFO = {
  configuredResolutions: ["720p", "1080p"],
  availableResolutions: ["240p", "360p", "720p", "1080p"],
  playlistResolutions: [
    { resolution: "240p", path: "/v/240p" },
    { resolution: "360p", path: "/v/360p" },
    { resolution: "720p", path: "/v/720p" },
    { resolution: "1080p", path: "/v/1080p" },
  ],
  storageResolutions: [{ resolution: "240p", path: "/v/240p" }],
  mp4Resolutions: [
    { resolution: "360p", path: "/v/play_360p.mp4" },
    { resolution: "720p", path: "/v/play_720p.mp4" },
  ],
  hasOriginal: true,
} as VideoResolutionsInfoModel;

// The bug: a dry run printed only "Result OK"; it has to say what would go.
test("--non-configured lists the HLS renditions the library no longer configures", () => {
  expect(cleanupPlan(INFO, { deleteNonConfiguredResolutions: true })).toEqual({
    items: [
      { kind: "hls", resolution: "240p", path: "/v/240p" },
      { kind: "hls", resolution: "360p", path: "/v/360p" },
    ],
    notPresent: [],
  });
});

test("--resolutions reports names the video doesn't have", () => {
  const plan = cleanupPlan(INFO, { resolutionsToDelete: "1080p,144p" });
  expect(plan.items.map(cleanupItemLabel)).toEqual(["HLS 1080p"]);
  expect(plan.notPresent).toEqual(["144p"]);
});

test("--outputs mp4 applies resolution selectors to the MP4 files", () => {
  expect(
    cleanupPlan(INFO, { allResolutions: true, outputs: "mp4" }).items.map(
      cleanupItemLabel,
    ),
  ).toEqual(["MP4 360p", "MP4 720p"]);
  expect(
    cleanupPlan(INFO, {
      resolutionsToDelete: "720p",
      outputs: "all",
    }).items.map(cleanupItemLabel),
  ).toEqual(["HLS 720p", "MP4 720p"]);
});

test("--mp4 and --original add every MP4 file and the stored original", () => {
  expect(
    cleanupPlan(INFO, { deleteMp4Files: true, deleteOriginal: true }).items.map(
      cleanupItemLabel,
    ),
  ).toEqual(["MP4 360p", "MP4 720p", "Original file"]);
  expect(
    cleanupPlan({ ...INFO, hasOriginal: false }, { deleteOriginal: true })
      .items,
  ).toEqual([]);
});

test("informativeMessage hides the API's generic success text", () => {
  expect(informativeMessage("OK")).toBeUndefined();
  expect(informativeMessage(" success ")).toBeUndefined();
  expect(informativeMessage("2 resolutions removed")).toBe(
    "2 resolutions removed",
  );
});
