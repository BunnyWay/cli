import { expect, test } from "bun:test";
import { deleteBlocker } from "./delete.ts";

test("deleteBlocker refuses the live production deploy", () => {
  expect(deleteBlocker({ current: "aaa", previous: "bbb" }, "aaa")).toContain(
    "live",
  );
});

test("deleteBlocker refuses the rollback target", () => {
  expect(deleteBlocker({ current: "aaa", previous: "bbb" }, "bbb")).toContain(
    "rollback",
  );
});

test("deleteBlocker allows any other deploy", () => {
  expect(deleteBlocker({ current: "aaa", previous: "bbb" }, "ccc")).toBe(
    undefined,
  );
  expect(deleteBlocker({}, "ccc")).toBe(undefined);
});
