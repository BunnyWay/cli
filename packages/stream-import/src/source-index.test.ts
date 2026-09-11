import { expect, test } from "bun:test";
import type { BunnyVideo } from "./bunny-types.ts";
import { buildSourceIndex } from "./source-index.ts";

const video = (
  guid: string,
  metaTags?: Array<{ property?: string; value?: string }>,
  status = 4,
) => ({ guid, metaTags, status }) as BunnyVideo;

test("indexes by the requested dedup tag only, skipping empty values and keeping the first duplicate", () => {
  const index = buildSourceIndex(
    [
      video("a", [
        { property: "description", value: "hello" },
        { property: "vimeoId", value: "111" },
      ]),
      video("dup", [{ property: "vimeoId", value: "111" }]),
      video("b", [{ property: "s3Source", value: "bucket/key.mp4" }]),
      video("c", [{ property: "vimeoId", value: "" }]),
      video("d"),
    ],
    "vimeoId",
  );

  expect(index.size).toBe(1);
  // Re-running an import must not reassign an already-linked video to a later duplicate.
  expect(index.get("111")?.guid).toBe("a");
});

test("a finished copy beats a failed one under the same tag, whatever the order", () => {
  const tag = [{ property: "vimeoId", value: "111" }];
  expect(
    buildSourceIndex(
      [video("dead", tag, 6), video("ok", tag, 4)],
      "vimeoId",
    ).get("111")?.guid,
  ).toBe("ok");
  expect(
    buildSourceIndex(
      [video("busy", tag, 2), video("dead", tag, 5)],
      "vimeoId",
    ).get("111")?.guid,
  ).toBe("busy");
});
