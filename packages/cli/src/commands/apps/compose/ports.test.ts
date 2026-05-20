import { expect, test } from "bun:test";
import { parsePortMapping } from "./ports.ts";

test.each([
  ["3000", { public: 3000, container: 3000 }],
  ["3000:80", { public: 3000, container: 80 }],
  ["127.0.0.1:3000:80", { public: 3000, container: 80 }],
  ["3000:80/tcp", { public: 3000, container: 80 }],
])("parsePortMapping(%j)", (input, expected) => {
  expect(parsePortMapping(input)).toEqual(expected);
});

test.each([
  [
    { target: 80, published: 3000 },
    { public: 3000, container: 80 },
  ],
  [{ target: 80 }, { public: 80, container: 80 }],
  [
    { target: 80, published: "3000" },
    { public: 3000, container: 80 },
  ],
])("parsePortMapping(%j) object form", (input, expected) => {
  expect(parsePortMapping(input)).toEqual(expected);
});

test("rejects port ranges", () => {
  expect(() => parsePortMapping("3000-3005:3000-3005")).toThrow(
    /not supported/,
  );
});

test("rejects garbage strings", () => {
  expect(() => parsePortMapping("not:a:port:mapping")).toThrow();
});
