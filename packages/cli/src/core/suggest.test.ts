import { expect, test } from "bun:test";
import { suggest } from "./suggest.ts";

const commands = [
  "login",
  "whoami",
  "db",
  "dns",
  "scripts",
  "storage",
  "config",
];

test.each([
  ["stroage", "storage"],
  ["confg", "config"],
  ["whoiam", "whoami"],
  ["sto", "storage"],
  ["dbb", "db"],
  ["x", undefined],
  ["s", undefined],
  ["list", undefined],
  ["zzzzzz", undefined],
  ["db", undefined],
])("%s suggests %s", (input, expected) => {
  expect(suggest(input, commands)).toBe(expected);
});
