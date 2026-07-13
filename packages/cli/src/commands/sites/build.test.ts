import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  envHash,
  parseEnvAssignments,
  parseEnvFile,
  runBuildCommand,
} from "./build.ts";

test("parseEnvAssignments parses KEY=VALUE pairs", () => {
  expect(parseEnvAssignments(["A=1", "B=with=equals", "C_1="])).toEqual({
    A: "1",
    B: "with=equals",
    C_1: "",
  });
  expect(parseEnvAssignments(undefined)).toEqual({});
});

test("parseEnvAssignments rejects malformed entries", () => {
  expect(() => parseEnvAssignments(["NOEQUALS"])).toThrow("Invalid --env");
  expect(() => parseEnvAssignments(["=value"])).toThrow("Invalid --env");
  expect(() => parseEnvAssignments(["1BAD=x"])).toThrow("not a valid");
});

test("parseEnvFile handles comments, blanks, and quotes", () => {
  const env = parseEnvFile(
    [
      "# comment",
      "",
      "PLAIN=value",
      'QUOTED="hello world"',
      "SINGLE='single'",
      "  SPACED = spaced-out  ",
      "not a var line",
    ].join("\n"),
  );
  expect(env).toEqual({
    PLAIN: "value",
    QUOTED: "hello world",
    SINGLE: "single",
    SPACED: "spaced-out",
  });
});

test("envHash is stable across ordering and sensitive to values", () => {
  const a = envHash({ A: "1", B: "2" });
  const b = envHash({ B: "2", A: "1" });
  expect(a).toBe(b);
  expect(a).toMatch(/^[0-9a-f]{8}$/);
  expect(envHash({ A: "1", B: "3" })).not.toBe(a);
});

test("runBuildCommand passes env and throws on failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-build-"));
  const out = join(dir, "out.txt");

  await runBuildCommand(`echo -n "$MY_VAR" > ${JSON.stringify(out)}`, dir, {
    MY_VAR: "built",
  });
  expect(await Bun.file(out).text()).toBe("built");

  await expect(runBuildCommand("exit 3", dir, {})).rejects.toThrow(
    "exit code 3",
  );
});
