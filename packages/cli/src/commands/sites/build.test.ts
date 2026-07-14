import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseEnvAssignments,
  parseEnvFile,
  resolveAutoBuild,
  runBuildCommand,
} from "./build.ts";

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-auto-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

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

test("parseEnvFile strips inline comments and unescapes inner quotes", () => {
  const env = parseEnvFile(
    [
      "INLINE=value # trailing comment",
      "HASHINVALUE=a#b",
      'ESCAPED="value with \\"quotes\\""',
      'HASHINQUOTES="a # b"',
    ].join("\n"),
  );
  expect(env).toEqual({
    INLINE: "value",
    HASHINVALUE: "a#b",
    ESCAPED: 'value with "quotes"',
    HASHINQUOTES: "a # b",
  });
});

test("resolveAutoBuild infers a detected framework's build and output dir", async () => {
  const dir = tempRepo({
    "package.json": JSON.stringify({
      name: "x",
      dependencies: { vite: "^6.0.0" },
    }),
    "pnpm-lock.yaml": "",
  });
  expect(await resolveAutoBuild(dir)).toEqual({
    command: "pnpm run build",
    label: "Vite",
    dir: "dist",
  });
});

test("resolveAutoBuild falls back to a package.json build script", async () => {
  const dir = tempRepo({
    "package.json": JSON.stringify({
      name: "x",
      scripts: { build: "tsc" },
    }),
  });
  expect(await resolveAutoBuild(dir)).toEqual({
    command: "npm run build",
    label: "a package.json build script",
  });
});

test("resolveAutoBuild returns null when nothing is detected", async () => {
  const dir = tempRepo({ "index.html": "<h1>hi</h1>" });
  expect(await resolveAutoBuild(dir)).toBeNull();

  const noBuildScript = tempRepo({
    "package.json": JSON.stringify({ name: "x", scripts: { test: "echo" } }),
  });
  expect(await resolveAutoBuild(noBuildScript)).toBeNull();
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
