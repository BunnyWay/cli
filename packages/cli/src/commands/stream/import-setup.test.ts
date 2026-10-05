import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudflareSource } from "@bunny.net/stream-import-cloudflare";
import { setImportCredentials } from "@/config/index.ts";
import { resolveSourceCredentials } from "./import-setup.ts";

const originalEnv = { ...process.env };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bunny-import-"));
  writeFileSync(join(dir, "bunnynet.json"), '{"profiles":{}}');
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
});

afterEach(() => {
  process.env = { ...originalEnv };
  rmSync(dir, { recursive: true, force: true });
});

test("saved credentials fill only what the environment leaves unset, per profile", async () => {
  setImportCredentials("work", "cloudflare", {
    apiToken: "saved-token",
    accountId: "saved-account",
  });
  process.env.CLOUDFLARE_ACCOUNT_ID = "env-account";

  const resolved = await resolveSourceCredentials(
    cloudflareSource,
    {},
    "work",
    "text",
  );
  expect(resolved.config).toEqual({
    apiToken: "saved-token",
    accountId: "env-account",
  });
  expect(resolved.fromSaved).toBe(true);

  await expect(
    resolveSourceCredentials(cloudflareSource, {}, "default", "text"),
  ).rejects.toThrow("Cloudflare Stream is not configured");
});
