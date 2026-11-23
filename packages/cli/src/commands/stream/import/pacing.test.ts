import { expect, test } from "bun:test";
import { requireSource } from "@/tools/stream/index.ts";
import { importPacing, pacingNotice, retryPacing } from "./pacing.ts";

const vimeo = requireSource("vimeo");
const s3 = requireSource("s3");

test("a large Vimeo import is paced with the Vimeo profile", () => {
  const pacing = importPacing(vimeo, 1500, {});
  expect(pacing).toMatchObject({
    concurrency: 2,
    delay: 10,
    requestTimeout: 120,
    applied: ["--concurrency 2", "--delay 10", "--request-timeout 120"],
    riskier: [],
  });
  const notice = pacingNotice(pacing, 1500);
  expect(notice.warn[0]).toBe(
    "Large library detected (1,500 videos to import). To keep it reliable, this import is paced with: --concurrency 2 --delay 10 --request-timeout 120",
  );
  expect(notice.info[0]).toContain("takes about 4h 10m");
});

test("flags the user passed win, and aggressive ones get a warning", () => {
  const pacing = importPacing(vimeo, 1500, {
    concurrency: 8,
    delay: 0,
    requestTimeout: 300,
  });
  expect(pacing).toMatchObject({
    concurrency: 8,
    delay: 0,
    requestTimeout: 300,
    applied: [],
  });
  expect(pacing.riskier.map((r) => r.flag)).toEqual(["concurrency", "delay"]);
  const { warn, info } = pacingNotice(pacing, 1500);
  expect(warn[0]).toContain(
    "Recommended settings: --concurrency 2 --delay 10 --request-timeout 120",
  );
  expect(warn[1]).toBe(
    "--concurrency 8 is above the recommended 2; videos may fail to import (the import then slows down by itself).",
  );
  expect(info).toEqual([]);
});

test("small imports, and sources without a profile, keep the usual defaults", () => {
  for (const [plugin, count] of [
    [vimeo, 500],
    [s3, 50_000],
  ] as const) {
    const pacing = importPacing(plugin, count, {});
    expect(pacing).toMatchObject({
      concurrency: 3,
      delay: 0,
      requestTimeout: 30,
      applied: [],
    });
    expect(pacing.profile).toBeUndefined();
    expect(pacingNotice(pacing, count)).toEqual({
      warn: [],
      info: [],
    });
  }
});

test("a retry after source rejections goes one at a time and at least 30s apart", () => {
  expect(retryPacing({})).toEqual({ concurrency: 1, delay: 30 });
  expect(retryPacing({ delay: 10 })).toEqual({ concurrency: 1, delay: 30 });
  expect(retryPacing({ delay: 45 })).toEqual({ concurrency: 1, delay: 90 });
  expect(retryPacing({ delay: 500 })).toEqual({ concurrency: 1, delay: 600 });
});
