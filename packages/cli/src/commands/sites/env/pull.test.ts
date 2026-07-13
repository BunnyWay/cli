import { expect, test } from "bun:test";
import { toDotenv } from "./pull.ts";

test("toDotenv sorts keys and quotes values that need it", () => {
  expect(
    toDotenv({
      B_URL: "https://api.example.com/v1",
      A_PLAIN: "simple-value",
      C_SPACED: "hello world",
      D_QUOTE: 'say "hi"',
    }),
  ).toBe(
    [
      "A_PLAIN=simple-value",
      "B_URL=https://api.example.com/v1",
      'C_SPACED="hello world"',
      'D_QUOTE="say \\"hi\\""',
      "",
    ].join("\n"),
  );
});

test("toDotenv of an empty env is just a newline", () => {
  expect(toDotenv({})).toBe("\n");
});
