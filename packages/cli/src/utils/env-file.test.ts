import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnvFile } from "./env-file.ts";

test("parsing tolerates comments, exports, and quoted values", () => {
  const envPath = join(mkdtempSync(join(tmpdir(), "bunny-env-")), ".env");
  writeFileSync(
    envPath,
    [
      "# a comment",
      "",
      "PLAIN=one",
      'QUOTED="two three"',
      "export EXPORTED='four'",
      "SPACED = five",
      "EMPTY=",
      "not a variable",
    ].join("\n"),
  );

  expect(parseEnvFile(envPath)).toEqual([
    { key: "PLAIN", value: "one" },
    { key: "QUOTED", value: "two three" },
    { key: "EXPORTED", value: "four" },
    { key: "SPACED", value: "five" },
    { key: "EMPTY", value: "" },
  ]);
});
