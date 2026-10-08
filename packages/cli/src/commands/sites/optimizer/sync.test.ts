import { expect, test } from "bun:test";
import { optimizableImages } from "./sync.ts";

test("optimizableImages counts only formats Optimizer converts", () => {
  expect(
    optimizableImages([
      { path: "images/hero.png", size: 500 },
      { path: "a.JPG", size: 100 },
      { path: "logo.svg", size: 50 },
      { path: "index.html", size: 10 },
      { path: "photo.webp", size: 20 },
    ]),
  ).toEqual({ count: 3, bytes: 620 });
});
