import { expect, test } from "bun:test";
import type { BunnyVideo } from "./bunny-types.ts";
import { buildSourceIndex } from "./source-index.ts";

const video = (
  guid: string,
  metaTags?: Array<{ property?: string; value?: string }>,
) => ({ guid, metaTags }) as BunnyVideo;

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
