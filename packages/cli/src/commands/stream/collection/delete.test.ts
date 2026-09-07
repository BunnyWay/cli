import { expect, test } from "bun:test";
import { collectionDeleteQuestion } from "./delete.ts";

test("the confirmation names the collection and its video count", () => {
  const question = collectionDeleteQuestion("Tutorials", 3);
  expect(question).toBe(
    "Delete collection Tutorials and the 3 video(s) inside it? This cannot be undone.",
  );
});

test("the confirmation never claims the videos survive", () => {
  const question = collectionDeleteQuestion("Tutorials", 3);
  expect(question).not.toMatch(/kept/i);
  expect(question).toContain("3 video(s)");
});

test("a missing video count reads as zero", () => {
  expect(collectionDeleteQuestion("Empty", undefined)).toBe(
    "Delete collection Empty and the 0 video(s) inside it? This cannot be undone.",
  );
});
