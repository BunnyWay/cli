import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { splitStatements } from "@bunny.net/database-shell";
import { errorMessage, UserError } from "../../../core/errors.ts";
import {
  DEFAULT_MIGRATIONS_DIR,
  DEFAULT_MIGRATIONS_PATTERN,
  FALLBACK_MIGRATIONS_DIRS,
  MIGRATIONS_TABLE,
} from "./constants.ts";

/** The client surface the engine needs, so tests can pass an in-memory client. */
export interface MigrationClient {
  execute(
    statement: string | { sql: string; args: unknown[] },
  ): Promise<{ rows: Record<string, unknown>[] }>;
  migrate(statements: { sql: string; args?: unknown[] }[]): Promise<unknown>;
}

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

export type MigrationState =
  | "applied"
  | "pending"
  | "modified"
  | "missing"
  | "out_of_order";

export interface MigrationStatus {
  name: string;
  state: MigrationState;
  /** Set for states backed by an applied tracking row. */
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

/**
 * Pick the directory used by `migrations create`.
 *
 * Creation never auto-detects an ORM output directory: writing a hand-authored
 * file there would bypass the ORM's journal. An explicit `--dir` still wins.
 */
export function resolveCreateMigrationsDir(dirArg?: string): string {
  return resolve(dirArg ?? DEFAULT_MIGRATIONS_DIR);
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * Read every `.sql` file matching `pattern` in `dir`, sorted by relative path.
 *
 * The portable, slash-separated relative path is the migration identity. The
 * default pattern only considers top-level files; `--pattern` opts into nested
 * ORM layouts without teaching the runner about ORM-specific journals.
 */
export function discoverMigrations(
  dir: string,
  pattern = DEFAULT_MIGRATIONS_PATTERN,
): MigrationFile[] {
  if (!isDirectory(dir)) {
    throw new UserError(
      `Migrations directory not found: ${dir}`,
      "Run `bunny db migrations create <name>` to create your first migration.",
    );
  }

  validateMigrationPattern(pattern);

  const files: MigrationFile[] = [];

  try {
    const glob = new Bun.Glob(pattern);
    for (const match of glob.scanSync({
      cwd: dir,
      dot: false,
      absolute: false,
      followSymlinks: false,
      onlyFiles: true,
    })) {
      if (!match.endsWith(".sql")) continue;

      const path = resolve(dir, match);
      const relativePath = relative(dir, path);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
      ) {
        throw new UserError(
          `Migration pattern must stay inside the migrations directory: ${pattern}`,
        );
      }

      const name = relativePath.replaceAll("\\", "/");
      const sql = readFileSync(path, "utf-8");
      files.push({ name, path, sql, checksum: checksum(sql) });
    }
  } catch (err: unknown) {
    if (err instanceof UserError) throw err;
    throw new UserError(
      `Could not discover migrations with pattern ${pattern}: ${errorMessage(err)}`,
    );
  }

  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function validateMigrationPattern(pattern: string): void {
  const portable = pattern.replaceAll("\\", "/");
  if (
    !pattern.trim() ||
    pattern.startsWith("!") ||
    isAbsolute(pattern) ||
    /^[A-Za-z]:\//.test(portable) ||
    portable.split("/").includes("..")
  ) {
    throw new UserError(
      `Invalid migration pattern: ${pattern}`,
      "Use a positive glob relative to the migrations directory, such as `*.sql` or `*/migration.sql`.",
    );
  }
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
 * Read the applied migrations without creating the tracking table.
 *
 * Used by the read paths (`list`, and `apply` before it has confirmation) so a
 * preview never writes. Connection and query failures become `UserError`, since
 * a bad URL or token is a user problem, not a crash.
 */
export async function readApplied(
  client: MigrationClient,
  table = MIGRATIONS_TABLE,
): Promise<AppliedMigration[]> {
  try {
    return (await migrationsTableExists(client, table))
      ? await fetchApplied(client, table)
      : [];
  } catch (err: unknown) {
    throw new UserError(
      `Could not read migration state: ${errorMessage(err)}`,
      "Check that the database URL and token are correct.",
    );
  }
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
  const newestApplied = applied.reduce(
    (newest, row) => (row.name > newest ? row.name : newest),
    "",
  );

  const statuses: MigrationStatus[] = files.map((file) => {
    const record = byName.get(file.name);
    if (!record) {
      return {
        name: file.name,
        state:
          newestApplied && file.name < newestApplied
            ? "out_of_order"
            : "pending",
      };
    }
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

/** Parse and validate a migration before any database write occurs. */
export function migrationStatements(file: MigrationFile): string[] {
  let statements: string[];
  try {
    statements = splitStatements(file.sql);
  } catch (err: unknown) {
    throw new UserError(
      `Could not parse ${file.name}: ${errorMessage(err)}`,
      "Fix the migration file before applying any pending migrations.",
    );
  }

  if (statements.length === 0) {
    throw new UserError(`No SQL statements found in ${file.name}.`);
  }

  return statements;
}

/** Apply one migration with foreign keys off, tracking row included, so it either lands and is recorded or neither. */
export async function applyMigration(
  client: MigrationClient,
  file: MigrationFile,
  options: { table?: string; statements?: string[] } = {},
): Promise<{ statements: number }> {
  const table = options.table ?? MIGRATIONS_TABLE;
  const statements = options.statements ?? migrationStatements(file);

  await client.migrate([
    ...statements.map((sql) => ({ sql })),
    {
      sql: `INSERT INTO ${quoteIdentifier(table)} (name, checksum) VALUES (?, ?)`,
      args: [file.name, file.checksum],
    },
  ]);

  return { statements: statements.length };
}
