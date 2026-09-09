import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectEnv, parseDotenv, splitPair } from "./env.ts";

describe("splitPair", () => {
  test("splits on the first = and validates the key", () => {
    expect(splitPair("B=with=equals")).toEqual(["B", "with=equals"]);
    expect(splitPair("C_1=")).toEqual(["C_1", ""]);
    expect(() => splitPair("NOEQUALS")).toThrow("Expected KEY=VALUE");
    expect(() => splitPair("=value")).toThrow("Invalid environment variable");
    expect(() => splitPair("1BAD=x")).toThrow("Invalid environment variable");
  });
});

describe("parseDotenv", () => {
  test("handles comments, blanks, export, and quotes", () => {
    expect(
      parseDotenv(
        [
          "# comment",
          "",
          "PLAIN=value",
          "export EXPORTED=x",
          'QUOTED="hello world"',
          "SINGLE='single'",
          "  SPACED = spaced-out  ",
          "not a var line",
        ].join("\n"),
      ),
    ).toEqual({
      PLAIN: "value",
      EXPORTED: "x",
      QUOTED: "hello world",
      SINGLE: "single",
      SPACED: "spaced-out",
    });
  });

  test("strips inline comments and unescapes inner quotes", () => {
    expect(
      parseDotenv(
        [
          "INLINE=value # trailing comment",
          "HASHINVALUE=a#b",
          'ESCAPED="value with \\"quotes\\""',
          'HASHINQUOTES="a # b"',
        ].join("\n"),
      ),
    ).toEqual({
      INLINE: "value",
      HASHINVALUE: "a#b",
      ESCAPED: 'value with "quotes"',
      HASHINQUOTES: "a # b",
    });
  });
});

describe("collectEnv", () => {
  test("an unclosed quote in the env file is an error, not a truncated value", async () => {
    const envFile = join(mkdtempSync(join(tmpdir(), "bunny-env-")), ".env");
    writeFileSync(envFile, 'OK=1\nBROKEN="never closed\n');
    await expect(collectEnv([], envFile)).rejects.toThrow("Unclosed quote in");
  });
});
