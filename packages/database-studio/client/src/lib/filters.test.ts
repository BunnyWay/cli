import { describe, expect, test } from "bun:test";
import { filterParams } from "./filters.ts";

describe("filterParams", () => {
  test("puts a filter on a column named like a paging parameter in a group", () => {
    expect(
      filterParams(
        [
          { column: "limit", operator: "eq", value: "5" },
          { column: "name", operator: "eq", value: "Ann" },
        ],
        "and",
      ),
    ).toEqual([
      ["or", "(limit.eq.5)"],
      ["name", "eq.Ann"],
    ]);
  });

  test("combines OR filters into one group, quoting values that need it", () => {
    expect(
      filterParams(
        [
          { column: "name", operator: "eq", value: "Smith, John" },
          { column: "age", operator: "null", value: "" },
        ],
        "or",
      ),
    ).toEqual([["or", '(name.eq."Smith, John",age.is.null)']]);
  });
});
