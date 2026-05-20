import { expect, test } from "bun:test";
import { parseDotenv } from "./parse.ts";

test.each<[string, string, Record<string, string>]>([
  [
    "simple KEY=value",
    "PORT=3000\nDATABASE_URL=postgres://x",
    {
      PORT: "3000",
      DATABASE_URL: "postgres://x",
    },
  ],
  [
    "blank lines and comments",
    "\n# header\nFOO=1\n\n# another\nBAR=2\n",
    {
      FOO: "1",
      BAR: "2",
    },
  ],
  [
    "double and single quotes stripped",
    `A="hello world"\nB='single quoted'`,
    {
      A: "hello world",
      B: "single quoted",
    },
  ],
  [
    "trailing inline comment on unquoted value",
    "PORT=3000 # the http port",
    {
      PORT: "3000",
    },
  ],
  [
    "'#' preserved inside quoted values",
    'TOKEN="abc#def"',
    {
      TOKEN: "abc#def",
    },
  ],
  ["leading 'export'", "export FOO=bar", { FOO: "bar" }],
  ["invalid identifiers rejected", "1BAD=x\nGOOD=y\n-foo=z", { GOOD: "y" }],
  ["lines without = ignored", "not_a_kvp\nFOO=bar", { FOO: "bar" }],
  ["later keys overwrite earlier", "X=1\nX=2", { X: "2" }],
])("parseDotenv: %s", (_name, input, expected) => {
  expect(parseDotenv(input)).toEqual(expected);
});
