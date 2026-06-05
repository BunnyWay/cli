import { describe, expect, test } from "bun:test";
import {
  BAR_WIDTH,
  formatBucketLabel,
  renderBarChart,
  sumChart,
} from "./stats.ts";

// --- sumChart ---

describe("sumChart", () => {
  test("sums chart values", () => {
    expect(sumChart({ "2026-05-01": 3, "2026-05-02": 7 })).toBe(10);
  });

  test("returns 0 for null/undefined", () => {
    expect(sumChart(null)).toBe(0);
    expect(sumChart(undefined)).toBe(0);
  });

  test("returns 0 for an empty chart", () => {
    expect(sumChart({})).toBe(0);
  });
});

// --- formatBucketLabel ---

describe("formatBucketLabel", () => {
  test("formats a daily UTC bucket as a friendly date", () => {
    expect(formatBucketLabel("2026-05-19T00:00:00Z")).toBe("May 19, 2026");
  });

  test("renders in UTC regardless of local timezone (no day shift)", () => {
    // Midnight UTC must stay on the same calendar day, not roll back west of UTC.
    expect(formatBucketLabel("2026-02-03T00:00:00Z")).toBe("Feb 3, 2026");
  });

  test("includes the UTC time when hourly", () => {
    expect(formatBucketLabel("2026-05-19T14:00:00Z", true)).toBe(
      "May 19, 2026 14:00",
    );
  });

  test("returns the raw value when unparseable", () => {
    expect(formatBucketLabel("not-a-date")).toBe("not-a-date");
  });
});

// --- renderBarChart ---

describe("renderBarChart", () => {
  test("renders one line per row with label and value", () => {
    const lines = renderBarChart([
      ["A", 10],
      ["BB", 5],
    ]).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("A");
    expect(lines[0]).toContain("10");
    expect(lines[1]).toContain("BB");
    expect(lines[1]).toContain("5");
  });

  test("the max value fills the full bar width", () => {
    const line = renderBarChart([["X", 100]]);
    expect([...line].filter((c) => c === "█")).toHaveLength(BAR_WIDTH);
  });

  test("a zero value renders no filled glyphs", () => {
    const line = renderBarChart([
      ["hit", 100],
      ["zero", 0],
    ]).split("\n")[1];
    expect(line).not.toContain("█");
  });
});
