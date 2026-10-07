import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsInstallSettings, projectPrefix, remoteHost } from "./scaffold.ts";

test("projectPrefix is empty at the workflow root and the POSIX offset when nested", () => {
  expect(projectPrefix("/repo", "/repo")).toBe("");
  expect(projectPrefix("/repo", "/repo/packages/site")).toBe("packages/site");
});

// A bunny.jsonc above the git root can't be referenced from a repo-rooted workflow.
test("projectPrefix is undefined when the project escapes the workflow root", () => {
  expect(projectPrefix("/repo/app", "/repo")).toBeUndefined();
});

test("remoteHost reads the host from scp-style and URL remotes", () => {
  expect(remoteHost("git@github.com:BunnyWay/cli.git")).toBe("github.com");
  expect(remoteHost("https://github.com/BunnyWay/cli.git")).toBe("github.com");
  expect(remoteHost("ssh://git@github.com/BunnyWay/cli.git")).toBe(
    "github.com",
  );
  expect(remoteHost("git@GitHub.com:BunnyWay/cli.git")).toBe("github.com");
});

// A substring check on the whole URL would treat all three of these as GitHub.
test("remoteHost does not confuse lookalike hosts for github.com", () => {
  expect(remoteHost("git@github.com.example.invalid:a/b.git")).toBe(
    "github.com.example.invalid",
  );
  expect(remoteHost("https://example.invalid/github.com/a/b")).toBe(
    "example.invalid",
  );
  expect(remoteHost("https://notgithub.com/a/b")).toBe("notgithub.com");
});

test("a nested workspace member without its own lockfile installs with the monorepo root's", async () => {
  const root = mkdtempSync(join(tmpdir(), "sites-scaffold-"));
  const web = join(root, "apps", "web");
  mkdirSync(web, { recursive: true });
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '6.0'\n");
  // Not a workspace yet: a standalone nested app can't use the root lockfile.
  expect((await jsInstallSettings(root, web)).lockfile).toBe(false);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: [apps/*]\n");
  expect(await jsInstallSettings(root, web)).toEqual({
    packageManager: "pnpm",
    lockfile: true,
    pnpmVersion: "8",
  });
  // A root `packageManager` pin is what pnpm/action-setup reads, so no explicit version.
  writeFileSync(
    join(root, "package.json"),
    '{ "packageManager": "pnpm@9.15.0" }',
  );
  expect((await jsInstallSettings(root, web)).pnpmVersion).toBeUndefined();
});
