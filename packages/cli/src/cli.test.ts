import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "bunny-cli-test-"));

function run(...args: string[]) {
  const proc = Bun.spawnSync(
    ["bun", join(import.meta.dir, "index.ts"), ...args],
    {
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: home,
        BUNNYNET_API_KEY: "",
        BUNNY_API_KEY: "",
      },
      stdin: "ignore",
    },
  );
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("small mistakes", () => {
  test("top-level typo suggests the command and points at help", () => {
    const { code, stderr } = run("storgae", "list");
    expect(code).toBe(1);
    expect(stderr).toContain("Did you mean storage?");
    expect(stderr).toContain("Run `bunny --help` for usage.");
    expect(stderr).not.toContain("Commands:");
  });

  test("flag typo suggests the flag, as JSON when asked", () => {
    const { stderr } = run("whoami", "--profle", "x");
    expect(stderr).toContain("Did you mean --profile?");
    const { stdout } = run("whoami", "--profle", "x", "-o", "json");
    expect(JSON.parse(stdout).hint).toContain("Did you mean --profile?");
  });

  test("unknown subcommand names what was rejected", () => {
    const { code, stderr } = run("storage", "list");
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown command: list");
  });

  test("non-numeric id is rejected instead of becoming NaN", () => {
    const { code, stderr } = run("scripts", "show", "abc");
    expect(code).toBe(1);
    expect(stderr).toContain("Invalid value for id: expected a number.");
  });

  test("unknown profile is a user error, not a crash", () => {
    const { code, stderr } = run("whoami", "--profile", "nope");
    expect(code).toBe(1);
    expect(stderr).toContain('Profile "nope" not found.');
  });
});
