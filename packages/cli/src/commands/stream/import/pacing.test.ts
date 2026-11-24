import { expect, test } from "bun:test";
import { importPacing, requireSource } from "@/tools/stream/index.ts";
import { pacingNotice, retryPacing, slowResumeFlags } from "./pacing.ts";

const vimeo = requireSource("vimeo");
const s3 = requireSource("s3");

test("a large Vimeo import is paced with the Vimeo profile", () => {
  const pacing = importPacing(vimeo, 1500, {});
  expect(pacing).toMatchObject({
    concurrency: 2,
    delay: 10,
    requestTimeout: 120,
  });
  const notice = pacingNotice(pacing, {}, 1500);
  expect(notice.warn[0]).toBe(
    "Large library detected (1,500 videos to import). To keep it reliable, this import is paced with: --concurrency 2 --delay 10 --request-timeout 120",
  );
  expect(notice.info[0]).toContain("takes about 4h 10m");
});

test("flags the user passed win, and aggressive ones get a warning", () => {
  const flags = { concurrency: 8, delay: 0, requestTimeout: 300 };
  const pacing = importPacing(vimeo, 1500, flags);
  expect(pacing).toMatchObject(flags);
  const { warn, info } = pacingNotice(pacing, flags, 1500);
  expect(warn[0]).toContain(
    "Recommended settings: --concurrency 2 --delay 10 --request-timeout 120",
  );
  expect(warn[1]).toBe(
    "--concurrency 8 is above the recommended 2; videos may fail to import (the import then slows down by itself).",
  );
  expect(warn).toHaveLength(3);
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
    });
    expect(pacing.profile).toBeUndefined();
    expect(pacingNotice(pacing, {}, count)).toEqual({
      warn: [],
      info: [],
    });
  }
});

test("a retry goes one at a time, at least 30s apart, and never faster than the failed run", () => {
  const pace = (delay: number, finalDelay = delay) =>
    retryPacing({ delay, finalDelay });
  expect(pace(0)).toEqual({ concurrency: 1, delay: 30 });
  expect(pace(45)).toEqual({ concurrency: 1, delay: 90 });
  expect(pace(10, 120)).toEqual({ concurrency: 1, delay: 240 });
  expect(pace(500)).toEqual({ concurrency: 1, delay: 600 });

  const still = { delay: 0, finalDelay: 0 };
  expect(slowResumeFlags([{ retryable: true }], still)).toBe(
    " --concurrency 1 --delay 30",
  );
  expect(
    slowResumeFlags([{ retryable: true }, { retryable: false }], still),
  ).toBe(" --clean-failed --concurrency 1 --delay 30");
});
