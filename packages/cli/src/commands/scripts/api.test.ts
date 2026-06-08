import { describe, expect, test } from "bun:test";
import { findAcrossPages } from "./api.ts";

/** Serve `pages` one at a time; `moreOnLast` keeps hasMore true past the end. */
function pager<T>(pages: T[][], moreOnLast = false) {
  let calls = 0;
  const fetchPage = async (page: number) => {
    calls += 1;
    return {
      items: pages[page - 1] ?? [],
      hasMore: moreOnLast || page < pages.length,
    };
  };
  return { fetchPage, calls: () => calls };
}

describe("findAcrossPages", () => {
  test("finds across pages, stopping as soon as it matches", async () => {
    const p = pager([[1, 2], [3], [4]]);
    expect(await findAcrossPages(p.fetchPage, (n) => n === 3)).toBe(3);
    expect(p.calls()).toBe(2);
  });

  test("returns undefined when no page matches", async () => {
    const p = pager([[1], [2]]);
    expect(
      await findAcrossPages(p.fetchPage, (n) => n === 999),
    ).toBeUndefined();
    expect(p.calls()).toBe(2);
  });

  test("stops on an empty page even if hasMore stays true", async () => {
    const p = pager<number>([[]], true);
    expect(await findAcrossPages(p.fetchPage, () => true)).toBeUndefined();
    expect(p.calls()).toBe(1);
  });
});
