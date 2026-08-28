import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contentHashId,
  gitIdentity,
  resolveDeployIdentity,
} from "./deploy-id.ts";

const FILES = [
  { path: "index.html", sha256: "AA11" },
  { path: "assets/app.js", sha256: "bb22" },
];

test("contentHashId is order-independent and case-normalizes hashes", () => {
  const a = contentHashId(FILES);
  const b = contentHashId([...FILES].reverse());
  const c = contentHashId(
    FILES.map((f) => ({ ...f, sha256: f.sha256.toLowerCase() })),
  );
  expect(a).toBe(b);
  expect(a).toBe(c);
  expect(a).toMatch(/^[0-9a-f]{12}$/);
});

test("contentHashId changes when content or paths change", () => {
  const base = contentHashId(FILES);
  expect(contentHashId([{ path: "index.html", sha256: "AA12" }])).not.toBe(
    base,
  );
  expect(
    contentHashId(FILES.map((f) => ({ ...f, path: `v2/${f.path}` }))),
  ).not.toBe(base);
});

async function run(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

test("gitIdentity is null outside a repo; resolveDeployIdentity falls back to content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-"));
  expect(await gitIdentity(dir)).toBeNull();

  const identity = await resolveDeployIdentity(dir, FILES);
  expect(identity.source).toBe("content");
  expect(identity.id).toBe(contentHashId(FILES));
});

test("clean git repo uses the short sha; dirty tree falls back to content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-git-"));
  await run(dir, ["init", "-q"]);
  await Bun.write(join(dir, "index.html"), "<h1>hi</h1>");
  await run(dir, ["add", "."]);
  await run(dir, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=test",
    "commit",
    "-q",
    "-m",
    "init",
  ]);

  const clean = await resolveDeployIdentity(dir, FILES);
  expect(clean.source).toBe("git");
  expect(clean.id).toMatch(/^[0-9a-f]{8,}$/);
  expect(clean.gitSha).toBe(clean.id);
  // The content hash is always carried, even when the display id is the git sha.
  expect(clean.contentHash).toBe(contentHashId(FILES));

  await Bun.write(join(dir, "new.txt"), "dirty");
  const dirty = await resolveDeployIdentity(dir, FILES);
  expect(dirty.source).toBe("content");
  expect(dirty.dirty).toBe(true);
  expect(dirty.id).toBe(contentHashId(FILES));
  expect(dirty.gitSha).toBe(clean.id);
});

test("a custom id wins over git and content, but still records both", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-custom-"));
  await run(dir, ["init", "-q"]);
  await Bun.write(join(dir, "index.html"), "<h1>hi</h1>");
  await run(dir, ["add", "."]);
  await run(dir, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=test",
    "commit",
    "-q",
    "-m",
    "init",
  ]);

  const identity = await resolveDeployIdentity(dir, FILES, "20260827-1433-r42");
  expect(identity.id).toBe("20260827-1433-r42");
  expect(identity.source).toBe("custom");
  // Provenance survives: the git sha is still recorded, and the content hash still drives the no-op check.
  expect(identity.gitSha).toMatch(/^[0-9a-f]{8}$/);
  expect(identity.contentHash).toBe(contentHashId(FILES));
});

test("a custom id works outside a git repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-custom-nogit-"));
  const identity = await resolveDeployIdentity(dir, FILES, "catalog_v3");
  expect(identity.id).toBe("catalog_v3");
  expect(identity.source).toBe("custom");
  expect(identity.gitSha).toBeUndefined();
  expect(identity.contentHash).toBe(contentHashId(FILES));
});

test("the same custom id with different content yields a different content hash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-custom-drift-"));
  const a = await resolveDeployIdentity(dir, FILES, "r42");
  const b = await resolveDeployIdentity(
    dir,
    [{ path: "index.html", sha256: "ff99" }],
    "r42",
  );
  expect(a.id).toBe(b.id);
  expect(a.contentHash).not.toBe(b.contentHash);
});
