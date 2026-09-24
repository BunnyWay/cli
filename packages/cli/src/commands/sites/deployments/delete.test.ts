import { expect, test } from "bun:test";
import { deleteBlocker } from "./delete.ts";

test("deleteBlocker refuses the live deploy and the rollback target, nothing else", () => {
  const state = { current: "aaa", previous: "bbb" };
  expect(deleteBlocker(state, "aaa")).toContain("live");
  expect(deleteBlocker(state, "bbb")).toContain("rollback");
  expect(deleteBlocker(state, "ccc")).toBeUndefined();
});
