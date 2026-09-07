import { expect, test } from "bun:test";
import { cleanupQuery, cleanupSummary } from "./cleanup.ts";

test("cleanupQuery maps each flag to its query param", () => {
  expect(
    cleanupQuery({
      resolutions: " 240p , 360p ",
      nonConfigured: true,
      original: true,
      mp4: true,
      dryRun: true,
      outputs: "HLS",
    }),
  ).toEqual({
    resolutionsToDelete: "240p,360p",
    deleteNonConfiguredResolutions: true,
    deleteOriginal: true,
    deleteMp4Files: true,
    dryRun: true,
    outputs: "hls",
  });
});

test("cleanupQuery sends only what was asked for", () => {
  expect(cleanupQuery({ all: true })).toEqual({ allResolutions: true });
});

// Every selector defaults to false server side, so an empty query is a silent no-op.
test("cleanupQuery refuses to run with nothing selected", () => {
  expect(() => cleanupQuery({})).toThrow(/Nothing selected to clean up/);
  expect(() => cleanupQuery({ dryRun: true })).toThrow(
    /Nothing selected to clean up/,
  );
  expect(() => cleanupQuery({ resolutions: " , " })).toThrow(
    /Nothing selected to clean up/,
  );
});

test("cleanupQuery validates --outputs against the documented values", () => {
  expect(cleanupQuery({ all: true, outputs: "mp4" }).outputs).toBe("mp4");
  expect(cleanupQuery({ all: true, outputs: "all" }).outputs).toBe("all");
  expect(() => cleanupQuery({ all: true, outputs: "dash" })).toThrow(
    /Invalid --outputs "dash"/,
  );
});

test("cleanupSummary describes the selection for the confirmation", () => {
  expect(
    cleanupSummary({ resolutionsToDelete: "240p", deleteOriginal: true }),
  ).toEqual(["resolutions 240p", "the original file"]);
  expect(cleanupSummary({ allResolutions: true })).toEqual([
    "every resolution",
  ]);
});
