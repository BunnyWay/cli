import { describe, expect, test } from "bun:test";
import { collectEnv, parseDotenv, splitPair } from "./env-args.ts";
import { envPrefix } from "./ssh-exec.ts";

describe("splitPair", () => {
  test("splits on the first =", () => {
    expect(splitPair("URL=http://x?a=b")).toEqual(["URL", "http://x?a=b"]);
  });

  test("allows empty values", () => {
    expect(splitPair("EMPTY=")).toEqual(["EMPTY", ""]);
  });

  test("rejects entries without =", () => {
    expect(() => splitPair("NOPE")).toThrow("Expected KEY=VALUE");
  });

  test("rejects invalid key names", () => {
    expect(() => splitPair("1BAD=x")).toThrow("Invalid environment variable");
    expect(() => splitPair("has-dash=x")).toThrow();
  });
});

describe("parseDotenv", () => {
  test("parses lines, comments, quotes and export", () => {
    const env = parseDotenv(
      [
        "# comment",
        "",
        "A=1",
        "export B=two",
        `C="quoted value"`,
        "D='single'",
        "  E = spaced ",
      ].join("\n"),
    );
    expect(env).toEqual({
      A: "1",
      B: "two",
      C: "quoted value",
      D: "single",
      E: "spaced",
    });
  });
});

describe("collectEnv", () => {
  test("entries override the env file (file loaded first)", async () => {
    // No env file here; just confirm entries merge in order.
    const env = await collectEnv(["A=1", "B=2", "A=3"]);
    expect(env).toEqual({ A: "3", B: "2" });
  });

  test("returns an empty object with no inputs", async () => {
    expect(await collectEnv()).toEqual({});
  });
});

describe("envPrefix", () => {
  test("builds a shell-quoted assignment prefix", () => {
    expect(envPrefix({ A: "1", B: "two words" })).toBe("A='1' B='two words' ");
  });

  test("escapes single quotes in values", () => {
    expect(envPrefix({ A: "it's" })).toBe("A='it'\\''s' ");
  });

  test("is empty when there are no vars", () => {
    expect(envPrefix({})).toBe("");
  });
});
