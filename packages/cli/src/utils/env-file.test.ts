import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseEnvFile,
  readEnvValue,
  removeEnvValue,
  writeEnvValue,
} from "./env-file.ts";

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

test("an empty value reads as unset, and a repeated key takes the last value", () => {
  const envPath = writeEnv([
    "BUNNY_DATABASE_URL=",
    "BUNNY_DATABASE_AUTH_TOKEN=",
    "DUP=first",
    "DUP=second",
  ]);
  const originalCwd = process.cwd();
  process.chdir(join(envPath, ".."));
  try {
    expect(readEnvValue("BUNNY_DATABASE_URL")).toBeUndefined();
    expect(readEnvValue("DUP")?.value).toBe("second");
  } finally {
    process.chdir(originalCwd);
  }
});

test("write and remove skip a key-shaped line inside another quoted value", () => {
  const envPath = writeEnv([
    "export TOKEN=old",
    'NOTE="line one',
    'TOKEN=keep"',
    "",
  ]);

  writeEnvValue("TOKEN", "new", envPath);
  expect(readFileSync(envPath, "utf-8")).toBe(
    'export TOKEN=new\nNOTE="line one\nTOKEN=keep"\n',
  );

  removeEnvValue("TOKEN", envPath);
  expect(readFileSync(envPath, "utf-8")).toBe('NOTE="line one\nTOKEN=keep"\n');
});

test("an unclosed quote blocks a strict read, and a new key is written above it", () => {
  const envPath = writeEnv(["A=1", 'NOTE="open', "TOKEN=hidden"]);
  const originalCwd = process.cwd();
  process.chdir(join(envPath, ".."));
  try {
    expect(readEnvValue("TOKEN")).toBeUndefined();
    expect(() => readEnvValue("TOKEN", { strict: true })).toThrow(
      "Unclosed quote",
    );

    writeEnvValue("TOKEN", "new", envPath);
    expect(readEnvValue("TOKEN")?.value).toBe("new");
  } finally {
    process.chdir(originalCwd);
  }
});
