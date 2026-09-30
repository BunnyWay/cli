import { expect, test } from "bun:test";
import { collectionDeleteQuestion } from "./delete.ts";

// The API cascade-deletes a collection's videos, so the prompt must say so.
test("the confirmation names the collection and the videos going with it", () => {
  expect(collectionDeleteQuestion("Tutorials", 3)).toBe(
    "Delete collection Tutorials and the 3 video(s) inside it? This cannot be undone.",
  );
});
