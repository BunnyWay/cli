import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { splitStatements } from "@bunny.net/database-shell";
import type { Client } from "@libsql/client";
import { UserError } from "../../../core/errors.ts";
import {
  DEFAULT_MIGRATIONS_DIR,
  FALLBACK_MIGRATIONS_DIRS,
  MIGRATIONS_TABLE,
} from "./constants.ts";

/** The libSQL client surface the engine needs, so tests can pass an in-memory client. */
export type MigrationClient = Pick<Client, "execute" | "migrate">;

export interface MigrationFile {
  /** Filename including the `.sql` extension, e.g. `0001_add_users.sql`. */
  name: string;
  path: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
  applied_at: string;
}

export type MigrationState = "applied" | "pending" | "modified" | "missing";

export interface MigrationStatus {
  name: string;
  state: MigrationState;
  /** Set for every state except `pending`. */
  appliedAt?: string;
}

/** Only bare identifiers are safe to interpolate into SQL, so refuse anything else. */
function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new UserError(`Invalid table name: ${name}`);
  }
  return `"${name}"`;
}

/** Hash of the migration body, normalized so line endings and trailing whitespace don't count as a change. */
export function checksum(sql: string): string {
  const normalized = sql.replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Pick the migrations directory.
 *
 * An explicit `--dir` always wins. Otherwise `migrations/` is used, falling back
 * to a known ORM output directory (`drizzle/`) when `migrations/` doesn't exist,
 * so `drizzle-kit generate` output works without configuration.
 */
export function resolveMigrationsDir(dirArg?: string): {
  dir: string;
  detected: boolean;
} {
  if (dirArg) return { dir: resolve(dirArg), detected: false };

  if (isDirectory(DEFAULT_MIGRATIONS_DIR)) {
    return { dir: resolve(DEFAULT_MIGRATIONS_DIR), detected: false };
  }

  for (const candidate of FALLBACK_MIGRATIONS_DIRS) {
    if (isDirectory(candidate)) {
      return { dir: resolve(candidate), detected: true };
    }
  }

  return { dir: resolve(DEFAULT_MIGRATIONS_DIR), detected: false };
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * Read every `.sql` file in `dir`, sorted by filename.
 *
 * Filenames are the migration identity, so the numeric prefix written by
 * `db migrations create` (and by `drizzle-kit generate`) determines order.
 * Subdirectories are ignored, which skips `drizzle/meta/`.
 */
export function discoverMigrations(dir: string): MigrationFile[] {
  if (!isDirectory(dir)) {
    throw new UserError(
      `Migrations directory not found: ${dir}`,
      "Run `bunny db migrations create <name>` to create your first migration.",
    );
  }

  const files: MigrationFile[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    if (!entry.name.endsWith(".sql")) continue;

    const path = join(dir, entry.name);
    const sql = readFileSync(path, "utf-8");
    files.push({ name: entry.name, path, sql, checksum: checksum(sql) });
  }

  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Next zero-padded sequence number, one above the highest numeric prefix present. */
export function nextSequence(files: MigrationFile[]): string {
  let highest = 0;
  for (const file of files) {
    const match = /^(\d+)/.exec(file.name);
    if (!match?.[1]) continue;
    highest = Math.max(highest, Number.parseInt(match[1], 10));
  }
  return String(highest + 1).padStart(4, "0");
}

/** Normalize a user-supplied migration name into a filename-safe slug. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!slug) {
    throw new UserError(
      `Migration name must contain at least one letter or number: ${name}`,
    );
  }

  return slug;
}

/** Create the tracking table if it isn't there yet. */
export async function ensureMigrationsTable(
  client: MigrationClient,
  table = MIGRATIONS_TABLE,
): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table)} (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}

/** True when the tracking table is present, so read-only commands don't have to create it. */
export async function migrationsTableExists(
  client: MigrationClient,
  table = MIGRATIONS_TABLE,
): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  return result.rows.length > 0;
}

/** Read the applied migrations, oldest first. Assumes the table exists. */
export async function fetchApplied(
  client: MigrationClient,
  table = MIGRATIONS_TABLE,
): Promise<AppliedMigration[]> {
  const result = await client.execute(
    `SELECT name, checksum, applied_at FROM ${quoteIdentifier(table)} ORDER BY id`,
  );

  return (result.rows as unknown as AppliedMigration[]).map((row) => ({
    name: String(row.name),
    checksum: String(row.checksum),
    applied_at: String(row.applied_at),
  }));
}

/**
 * Join the files on disk with what the database has recorded.
 *
 * A file whose checksum no longer matches the recorded one is `modified`; a
 * recorded migration with no matching file is `missing`. Both mean the local
 * migrations no longer describe the database, so callers surface them.
 */
export function migrationStatuses(
  files: MigrationFile[],
  applied: AppliedMigration[],
): MigrationStatus[] {
  const byName = new Map(applied.map((row) => [row.name, row]));

  const statuses: MigrationStatus[] = files.map((file) => {
    const record = byName.get(file.name);
    if (!record) return { name: file.name, state: "pending" };
    return {
      name: file.name,
      state: record.checksum === file.checksum ? "applied" : "modified",
      appliedAt: record.applied_at,
    };
  });

  const onDisk = new Set(files.map((file) => file.name));
  for (const record of applied) {
    if (onDisk.has(record.name)) continue;
    statuses.push({
      name: record.name,
      state: "missing",
      appliedAt: record.applied_at,
    });
  }

  return statuses;
}

/** Files that haven't been applied yet, in filename order. */
export function pendingMigrations(
  files: MigrationFile[],
  applied: AppliedMigration[],
): MigrationFile[] {
  const byName = new Set(applied.map((row) => row.name));
  return files.filter((file) => !byName.has(file.name));
}

/**
 * Apply one migration.
 *
 * Uses `migrate()` rather than `batch()` so foreign keys are deferred for the
 * duration, which table rebuilds and `ALTER TABLE` need. The tracking row is
 * part of the same batch, so a migration either lands and is recorded or
 * neither happens.
 */
export async function applyMigration(
  client: MigrationClient,
  file: MigrationFile,
  table = MIGRATIONS_TABLE,
): Promise<{ statements: number }> {
  const statements = splitStatements(file.sql);

  if (statements.length === 0) {
    throw new UserError(`No SQL statements found in ${file.name}.`);
  }

  await client.migrate([
    ...statements.map((sql) => ({ sql })),
    {
      sql: `INSERT INTO ${quoteIdentifier(table)} (name, checksum) VALUES (?, ?)`,
      args: [file.name, file.checksum],
    },
  ]);

  return { statements: statements.length };
}
