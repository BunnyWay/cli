import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolContext } from "@bunny.net/tools";
import { setImportCredentials } from "@/config/index.ts";
import { withSavedCredentials } from "./import-setup.ts";

const originalConfigHome = process.env.XDG_CONFIG_HOME;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bunny-import-"));
  writeFileSync(join(dir, "bunnynet.json"), '{"profiles":{}}');
  process.env.XDG_CONFIG_HOME = dir;
});

afterEach(() => {
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfigHome;
  rmSync(dir, { recursive: true, force: true });
});

test("saved credentials fill only what the environment leaves unset, per profile", () => {
  setImportCredentials("work", "cloudflare", {
    CLOUDFLARE_API_TOKEN: "saved-token",
    CLOUDFLARE_ACCOUNT_ID: "saved-account",
  });
  const ctx = createToolContext({
    env: { CLOUDFLARE_ACCOUNT_ID: "env-account" },
  });

  const saved = withSavedCredentials(ctx, "work");
  expect(saved.ctx.env.CLOUDFLARE_API_TOKEN).toBe("saved-token");
  expect(saved.ctx.env.CLOUDFLARE_ACCOUNT_ID).toBe("env-account");
  expect(saved.used.get("cloudflare")).toEqual({
    CLOUDFLARE_API_TOKEN: "saved-token",
  });

  expect(withSavedCredentials(ctx, "default").used.size).toBe(0);

  const file = join(dir, "bunnynet", "stream-import-credentials.json");
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readFileSync(join(dir, "bunnynet.json"), "utf-8")).not.toContain(
    "saved-token",
  );
});
