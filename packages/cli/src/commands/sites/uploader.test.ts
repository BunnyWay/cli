import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageZone } from "@/commands/storage/files-api.ts";
import { siteFiles } from "./api.ts";
import {
  collectFiles,
  hashFiles,
  shouldSkipEntry,
  uploadDeploy,
} from "./uploader.ts";

const realUpload = siteFiles.upload;
afterEach(() => {
  siteFiles.upload = realUpload;
});

const fakeConnection = {} as StorageZone;

function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-upload-"));
  Bun.write(join(dir, "index.html"), "<h1>hi</h1>");
  mkdirSync(join(dir, "assets"));
  Bun.write(join(dir, "assets", "app.js"), "console.log(1)");
  Bun.write(join(dir, ".env"), "SECRET=1");
  mkdirSync(join(dir, ".git"));
  Bun.write(join(dir, ".git", "config"), "x");
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  Bun.write(join(dir, "node_modules", "pkg", "index.js"), "x");
  return dir;
}

test("shouldSkipEntry excludes dotfiles and node_modules", () => {
  expect(shouldSkipEntry(".env")).toBe(true);
  expect(shouldSkipEntry(".git")).toBe(true);
  expect(shouldSkipEntry("node_modules")).toBe(true);
  expect(shouldSkipEntry("index.html")).toBe(false);
  expect(shouldSkipEntry("assets")).toBe(false);
  // Web-visible standards dirs must ship despite the leading dot.
  expect(shouldSkipEntry(".well-known")).toBe(false);
});

test("collectFiles walks recursively, skipping excluded entries, sorted", () => {
  const files = collectFiles(tree());
  expect(files.map((f) => f.path)).toEqual(["assets/app.js", "index.html"]);
  expect(files[1]?.size).toBeGreaterThan(0);
});

test("collectFiles keeps .well-known content", () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-sites-wk-"));
  Bun.write(join(dir, "index.html"), "<h1>hi</h1>");
  mkdirSync(join(dir, ".well-known"));
  Bun.write(join(dir, ".well-known", "security.txt"), "Contact: mailto:x@y");

  const files = collectFiles(dir);
  expect(files.map((f) => f.path)).toEqual([
    ".well-known/security.txt",
    "index.html",
  ]);
});

test("hashFiles computes the content sha256", async () => {
  const dir = tree();
  const [first] = await hashFiles(
    collectFiles(dir).filter((f) => f.path === "index.html"),
  );
  const expected = new Bun.CryptoHasher("sha256")
    .update("<h1>hi</h1>")
    .digest("hex");
  expect(first?.sha256).toBe(expected);
});

test("uploadDeploy targets deploys/{id}, sends checksums, and retries failures", async () => {
  const dir = tree();
  const files = await hashFiles(collectFiles(dir));

  const uploaded: Array<{ path: string; checksum?: string }> = [];
  let failuresLeft = 1;
  siteFiles.upload = async (_zone, path, _stream, options) => {
    // First call fails once to exercise the retry path.
    if (failuresLeft > 0) {
      failuresLeft--;
      throw new Error("transient");
    }
    uploaded.push({ path, checksum: options?.sha256Checksum });
  };

  await uploadDeploy(fakeConnection, "a1b2c3d4", files, { concurrency: 2 });

  expect(uploaded.map((u) => u.path).sort()).toEqual([
    "deploys/a1b2c3d4/assets/app.js",
    "deploys/a1b2c3d4/index.html",
  ]);
  for (const u of uploaded) {
    expect(u.checksum).toMatch(/^[0-9A-F]{64}$/);
  }
});

test("uploadDeploy rejects an empty file set", async () => {
  await expect(uploadDeploy(fakeConnection, "a1b2c3d4", [])).rejects.toThrow(
    "Nothing to upload",
  );
});

test("uploadDeploy surfaces an error after retries are exhausted", async () => {
  const dir = tree();
  const files = await hashFiles(collectFiles(dir));
  siteFiles.upload = async () => {
    throw new Error("permanent");
  };
  await expect(uploadDeploy(fakeConnection, "a1b2c3d4", files)).rejects.toThrow(
    "permanent",
  );
});
