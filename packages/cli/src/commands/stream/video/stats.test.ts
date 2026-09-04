import { expect, test } from "bun:test";
import { statsView } from "./stats.ts";

test("statsView defaults to the statistics view", () => {
  expect(statsView({})).toBe("stats");
});

test("statsView switches on the view flags", () => {
  expect(statsView({ heatmap: true })).toBe("heatmap");
  expect(statsView({ playData: true })).toBe("play-data");
});

// They read from different endpoints, so one call cannot answer both.
test("statsView refuses both view flags at once", () => {
  expect(() => statsView({ heatmap: true, playData: true })).toThrow(
    /Pass either --heatmap or --play-data, not both/,
  );
});
