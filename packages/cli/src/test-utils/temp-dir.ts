import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function useTempDir(prefix = "bunny-test-"): () => string {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), prefix));
  });
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });
  return () => dir;
}
