import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Ratchet for the actions migration: command modules must not talk to the API
 * directly. Business logic belongs in `@bunny.net/actions`; a command is glue
 * (flags, prompts, rendering) around `defineActionCommand` or `action.invoke`.
 *
 * Files listed here still create their own clients. Migrating a family removes
 * its entries; adding a NEW direct client use fails this test. Do not add
 * entries: write an action instead. The list only shrinks.
 */
const PENDING_MIGRATION = new Set([
  "commands/apps/delete.ts",
  "commands/apps/deploy.ts",
  "commands/apps/endpoints/add.ts",
  "commands/apps/endpoints/list.ts",
  "commands/apps/endpoints/remove.ts",
  "commands/apps/env/list.ts",
  "commands/apps/env/pull.ts",
  "commands/apps/env/push.ts",
  "commands/apps/env/remove.ts",
  "commands/apps/env/set.ts",
  "commands/apps/init.ts",
  "commands/apps/link.ts",
  "commands/apps/list.ts",
  "commands/apps/pull.ts",
  "commands/apps/push.ts",
  "commands/apps/regions/list.ts",
  "commands/apps/regions/show.ts",
  "commands/apps/restart.ts",
  "commands/apps/show.ts",
  "commands/apps/undeploy.ts",
  "commands/apps/volumes/list.ts",
  "commands/apps/volumes/remove.ts",
  "commands/auth/login.ts",
  "commands/dns/record/add.ts",
  "commands/dns/record/export.ts",
  "commands/dns/record/import.ts",
  "commands/dns/record/preset.ts",
  "commands/dns/record/scan.ts",
  "commands/dns/scripts/attach.ts",
  "commands/dns/scripts/create.ts",
  "commands/dns/scripts/deploy.ts",
  "commands/dns/scripts/init.ts",
  "commands/dns/scripts/link.ts",
  "commands/dns/scripts/list.ts",
  "commands/dns/zone/add.ts",
  "commands/dns/zone/dnssec/disable.ts",
  "commands/dns/zone/dnssec/enable.ts",
  "commands/dns/zone/link.ts",
  "commands/dns/zone/logging/disable.ts",
  "commands/dns/zone/logging/enable.ts",
  "commands/dns/zone/nameservers.ts",
  "commands/dns/zone/stats.ts",
  "commands/sandbox/url/delete.ts",
  "commands/sandbox/url/list.ts",
  "commands/scripts/create.ts",
  "commands/scripts/delete.ts",
  "commands/scripts/deploy.ts",
  "commands/scripts/deployments/list.ts",
  "commands/scripts/deployments/publish.ts",
  "commands/scripts/env/list.ts",
  "commands/scripts/env/pull.ts",
  "commands/scripts/env/remove.ts",
  "commands/scripts/env/set.ts",
  "commands/scripts/hostnames/index.ts",
  "commands/scripts/link.ts",
  "commands/scripts/list.ts",
  "commands/scripts/show.ts",
  "commands/scripts/stats.ts",
  "commands/sites/ci/init.ts",
  "commands/sites/create.ts",
  "commands/sites/delete.ts",
  "commands/sites/deploy.ts",
  "commands/sites/deployments/list.ts",
  "commands/sites/deployments/prune.ts",
  "commands/sites/deployments/publish.ts",
  "commands/sites/domains/index.ts",
  "commands/sites/link.ts",
  "commands/sites/list.ts",
  "commands/sites/open.ts",
  "commands/sites/show.ts",
  "commands/sites/ssl.ts",
  "commands/sites/upgrade-router.ts",
  // Mounted from core/hostnames by storage, sites, and scripts alike; it migrates
  // with the pull-zone hostname family, not with storage on its own.
  "commands/storage/zone/hostnames/index.ts",
  "commands/whoami.ts",
]);

const SRC_ROOT = join(import.meta.dir, "..");
const COMMANDS_ROOT = join(SRC_ROOT, "commands");

// A value import of a client factory, or any use of clientOptions().
const CLIENT_FACTORY_IMPORT =
  /import\s*\{[^}]*\bcreate\w+Client\b[^}]*\}\s*from\s*"@bunny\.net\/openapi-client"/;
const CLIENT_OPTIONS_USE = /\bclientOptions\b/;

function commandFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(dir, f));
}

function offenders(): Set<string> {
  const found = new Set<string>();
  for (const file of commandFiles(COMMANDS_ROOT)) {
    const src = readFileSync(file, "utf8");
    if (CLIENT_FACTORY_IMPORT.test(src) || CLIENT_OPTIONS_USE.test(src)) {
      found.add(relative(SRC_ROOT, file));
    }
  }
  return found;
}

test("commands do not create API clients outside the actions layer", () => {
  const current = offenders();

  const regressions = [...current].filter((f) => !PENDING_MIGRATION.has(f));
  expect(
    regressions,
    "These command files create API clients directly. Move the API work into @bunny.net/actions and call it via defineActionCommand or action.invoke instead.",
  ).toEqual([]);

  const migrated = [...PENDING_MIGRATION].filter((f) => !current.has(f));
  expect(
    migrated,
    "These files no longer create clients directly. Remove them from PENDING_MIGRATION so the ratchet keeps tightening.",
  ).toEqual([]);
});
