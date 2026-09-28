import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnvFile, readEnvValue } from "./env-file.ts";

function writeEnv(lines: string[]): string {
  const envPath = join(mkdtempSync(join(tmpdir(), "bunny-env-")), ".env");
  writeFileSync(envPath, lines.join("\n"));
  return envPath;
}

test("parsing tolerates comments, exports, and quoted values", () => {
  const envPath = writeEnv([
    "# a comment",
    "",
    "PLAIN=one",
    'QUOTED="two three"',
    "export EXPORTED='four'",
    "SPACED = five",
    "EMPTY=",
    "COMMENTED= # nothing here",
    "TRAILING=six # dev only",
    "HASHED=pass#word",
    "not a variable",
  ]);

  expect(parseEnvFile(envPath)).toEqual({
    entries: [
      { key: "PLAIN", value: "one" },
      { key: "QUOTED", value: "two three" },
      { key: "EXPORTED", value: "four" },
      { key: "SPACED", value: "five" },
      { key: "EMPTY", value: "" },
      { key: "COMMENTED", value: "" },
      { key: "TRAILING", value: "six" },
      { key: "HASHED", value: "pass#word" },
    ],
    unterminated: [],
  });
});

test("a quoted value spans lines, and an unclosed one is reported not truncated", () => {
  const envPath = writeEnv([
    'PEM="-----BEGIN KEY-----',
    "MIIEvQIBADAN",
    '-----END KEY-----"',
    'ESCAPED="line\\none"',
    'BROKEN="never closed',
  ]);

  expect(parseEnvFile(envPath)).toEqual({
    entries: [
      {
        key: "PEM",
        value: "-----BEGIN KEY-----\nMIIEvQIBADAN\n-----END KEY-----",
      },
      { key: "ESCAPED", value: "line\none" },
    ],
    unterminated: ["BROKEN"],
  });
});

test("an empty value reads as unset instead of taking the next line", () => {
  const envPath = writeEnv([
    "BUNNY_DATABASE_URL=",
    "BUNNY_DATABASE_AUTH_TOKEN=",
  ]);
  const originalCwd = process.cwd();
  process.chdir(join(envPath, ".."));
  try {
    expect(readEnvValue("BUNNY_DATABASE_URL")).toBeUndefined();
  } finally {
    process.chdir(originalCwd);
  }
});
