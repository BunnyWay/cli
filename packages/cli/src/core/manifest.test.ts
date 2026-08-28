import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ignoreManifestDir } from "./manifest.ts";

function repo(files: Record<string, string> = {}, git = true): string {
  const dir = mkdtempSync(join(tmpdir(), "bunny-manifest-"));
  if (git) mkdirSync(join(dir, ".git"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test("adds .bunny/ to a repository with no .gitignore", () => {
  const dir = repo();
  expect(ignoreManifestDir(dir)).toBe(true);
  expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(".bunny/\n");
});

test("keeps what the .gitignore already had, and ends the file with a newline", () => {
  const dir = repo({ ".gitignore": "dist\nnode_modules" });
  expect(ignoreManifestDir(dir)).toBe(true);
  expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(
    "dist\nnode_modules\n.bunny/\n",
  );
});

test("does nothing when a rule for .bunny is already there", () => {
  for (const line of [".bunny/", ".bunny", "/.bunny/", "  .bunny/  "]) {
    const dir = repo({ ".gitignore": `dist\n${line}\n` });
    expect(ignoreManifestDir(dir)).toBe(false);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(
      `dist\n${line}\n`,
    );
  }
});

// A directory that is not a repository gets no file it did not ask for.
test("writes nothing outside a git repository", () => {
  const dir = repo({}, false);
  expect(ignoreManifestDir(dir)).toBe(false);
});

// `.bunnyrc` is not `.bunny`, and a comment is not a rule.
test("is not fooled by a similar line", () => {
  const dir = repo({ ".gitignore": "# .bunny/\n.bunnyrc\n" });
  expect(ignoreManifestDir(dir)).toBe(true);
  expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(
    "\n.bunny/\n",
  );
});
