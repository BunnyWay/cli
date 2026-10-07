import { expect, test } from "bun:test";
import { statsView } from "./stats.ts";

// They read from different endpoints, so one call cannot answer both.
test("statsView refuses both view flags at once", () => {
  expect(() => statsView({ heatmap: true, playData: true })).toThrow(
    /Pass either --heatmap or --play-data, not both/,
  );
});
