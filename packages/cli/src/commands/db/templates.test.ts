import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyMigration,
  discoverMigrations,
  ensureMigrationsTable,
  type MigrationClient,
} from "./migrations/engine.ts";
import {
  assertNoExistingMigrations,
  DATABASE_TEMPLATES,
  findTemplate,
  writeTemplateMigration,
} from "./templates.ts";

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "bunny-db-templates-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function memoryClient(): MigrationClient {
  const db = new Database(":memory:");
  const run = (sql: string, args: unknown[]) =>
    db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];

  return {
    query: async (sql, args = []) => run(sql, args),
    batch: async (statements) => {
      for (const { sql, args } of statements) run(sql, args ?? []);
    },
  };
}

test("every template is embedded and resolves by short or versioned id", () => {
  expect(DATABASE_TEMPLATES.length).toBeGreaterThan(0);
  for (const template of DATABASE_TEMPLATES) {
    expect(template.sql).toContain("CREATE TABLE");
    expect(findTemplate(template.id)).toBe(template);
    expect(findTemplate(template.id.replace(/-\d+$/, ""))).toBe(template);
  }
});

test("a written template migration applies and creates its tables", async () => {
  const template = findTemplate("blog");
  const migration = writeTemplateMigration(template!, dir);

  expect(discoverMigrations(dir).map((f) => f.name)).toEqual(["0001_blog.sql"]);

  const client = memoryClient();
  await ensureMigrationsTable(client);
  await applyMigration(client, migration);

  const tables = await client.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'",
  );
  expect(tables.map((row) => row.name).sort()).toEqual(
    [...template!.tables].sort(),
  );
});

test("a project that already has migrations refuses a template", () => {
  writeFileSync(join(dir, "0001_existing.sql"), "SELECT 1;");
  expect(() => assertNoExistingMigrations(dir)).toThrow(/already holds/);
});
