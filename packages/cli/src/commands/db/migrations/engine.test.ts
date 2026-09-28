import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMigrationHistorySafe, migrationHistoryIssues } from "./drift.ts";
import {
  applyMigration,
  checksum,
  discoverMigrations,
  ensureMigrationsTable,
  fetchApplied,
  type MigrationClient,
  migrationStatements,
  migrationStatuses,
  migrationsTableExists,
  nextSequence,
  pendingMigrations,
  readApplied,
  resolveCreateMigrationsDir,
  resolveMigrationsDir,
  slugify,
} from "./engine.ts";

let dir: string;

beforeEach(() => {
  // realpath so chdir-based assertions match on macOS, where /var is a symlink to /private/var.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "bunny-migrations-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, sql: string) {
  writeFileSync(join(dir, name), sql);
}

/**
 * A real SQLite database behind the engine's client surface. `batch()` mirrors
 * what the wire batch does: foreign keys off, outside a deferred transaction.
 */
function memoryClient(): MigrationClient {
  const db = new Database(":memory:");
  const run = (sql: string, args: unknown[]) =>
    db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];

  return {
    query: async (sql, args = []) => run(sql, args),
    batch: async (statements) => {
      db.exec("PRAGMA foreign_keys=off");
      try {
        db.exec("BEGIN DEFERRED");
        try {
          for (const { sql, args } of statements) run(sql, args ?? []);
          db.exec("COMMIT");
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      } finally {
        db.exec("PRAGMA foreign_keys=on");
      }
    },
  };
}

describe("discoverMigrations", () => {
  test("returns .sql files in filename order", () => {
    write("0002_second.sql", "SELECT 2;");
    write("0001_first.sql", "SELECT 1;");
    write("0010_tenth.sql", "SELECT 10;");

    expect(discoverMigrations(dir).map((f) => f.name)).toEqual([
      "0001_first.sql",
      "0002_second.sql",
      "0010_tenth.sql",
    ]);
  });

  test("ignores non-sql files, dotfiles, and subdirectories", () => {
    write("0001_first.sql", "SELECT 1;");
    write("README.md", "not sql");
    write(".hidden.sql", "SELECT 0;");
    mkdirSync(join(dir, "meta"));
    writeFileSync(join(dir, "meta", "_journal.json"), "{}");

    expect(discoverMigrations(dir).map((f) => f.name)).toEqual([
      "0001_first.sql",
    ]);
  });

  test("supports nested layouts through a relative glob", () => {
    mkdirSync(join(dir, "0002_second"));
    mkdirSync(join(dir, "0001_first"));
    writeFileSync(join(dir, "0002_second", "migration.sql"), "SELECT 2;");
    writeFileSync(join(dir, "0001_first", "migration.sql"), "SELECT 1;");
    write("README.md", "not sql");

    expect(
      discoverMigrations(dir, "*/migration.sql").map((file) => file.name),
    ).toEqual(["0001_first/migration.sql", "0002_second/migration.sql"]);
  });

  test("can combine top-level and nested SQL with a recursive glob", () => {
    write("0001_first.sql", "SELECT 1;");
    mkdirSync(join(dir, "0002_second"));
    writeFileSync(join(dir, "0002_second", "migration.sql"), "SELECT 2;");

    expect(
      discoverMigrations(dir, "**/*.sql").map((file) => file.name),
    ).toEqual(["0001_first.sql", "0002_second/migration.sql"]);
  });

  test("rejects patterns that can escape the migrations directory", () => {
    expect(() => discoverMigrations(dir, "../*.sql")).toThrow(
      /Invalid migration pattern/,
    );
    expect(() => discoverMigrations(dir, "/tmp/*.sql")).toThrow(
      /Invalid migration pattern/,
    );
    expect(() => discoverMigrations(dir, "!*.sql")).toThrow(
      /Invalid migration pattern/,
    );
  });

  test("throws a hinted error when the directory is missing", () => {
    expect(() => discoverMigrations(join(dir, "nope"))).toThrow(
      /Migrations directory not found/,
    );
  });

  test("ten or more migrations stay ordered because prefixes are zero-padded", () => {
    for (let i = 1; i <= 12; i++) {
      write(`${String(i).padStart(4, "0")}_m.sql`, `SELECT ${i};`);
    }

    const names = discoverMigrations(dir).map((f) => f.name);
    expect(names[8]).toBe("0009_m.sql");
    expect(names[9]).toBe("0010_m.sql");
  });
});

describe("checksum", () => {
  test("ignores line endings and trailing whitespace", () => {
    expect(checksum("SELECT 1;\nSELECT 2;")).toBe(
      checksum("SELECT 1;\r\nSELECT 2;\n\n"),
    );
  });

  test("changes when the SQL changes", () => {
    expect(checksum("SELECT 1;")).not.toBe(checksum("SELECT 2;"));
  });
});

describe("nextSequence", () => {
  test("starts at 0001 with no migrations", () => {
    expect(nextSequence([])).toBe("0001");
  });

  test("increments past the highest prefix, not the count", () => {
    write("0001_a.sql", "SELECT 1;");
    write("0007_b.sql", "SELECT 1;");
    expect(nextSequence(discoverMigrations(dir))).toBe("0008");
  });

  test("follows on from drizzle's zero-based numbering", () => {
    write("0000_curly_bat.sql", "SELECT 1;");
    expect(nextSequence(discoverMigrations(dir))).toBe("0001");
  });

  test("ignores files with no numeric prefix", () => {
    write("init.sql", "SELECT 1;");
    expect(nextSequence(discoverMigrations(dir))).toBe("0001");
  });
});

describe("slugify", () => {
  test("normalizes separators and casing", () => {
    expect(slugify("Add Users Table")).toBe("add_users_table");
    expect(slugify("add-users--table")).toBe("add_users_table");
    expect(slugify("  trim me  ")).toBe("trim_me");
  });

  test("rejects names with nothing usable", () => {
    expect(() => slugify("---")).toThrow(/at least one letter or number/);
  });
});

describe("resolveMigrationsDir", () => {
  const cwd = process.cwd();

  afterEach(() => {
    process.chdir(cwd);
  });

  test("an explicit dir wins", () => {
    process.chdir(dir);
    mkdirSync(join(dir, "migrations"));
    const resolved = resolveMigrationsDir("custom");
    expect(resolved.dir).toBe(join(dir, "custom"));
    expect(resolved.detected).toBe(false);
  });

  test("prefers migrations/ when it exists", () => {
    process.chdir(dir);
    mkdirSync(join(dir, "migrations"));
    mkdirSync(join(dir, "drizzle"));
    expect(resolveMigrationsDir()).toEqual({
      dir: join(dir, "migrations"),
      detected: false,
    });
  });

  test("falls back to drizzle/ when migrations/ is absent", () => {
    process.chdir(dir);
    mkdirSync(join(dir, "drizzle"));
    expect(resolveMigrationsDir()).toEqual({
      dir: join(dir, "drizzle"),
      detected: true,
    });
  });

  test("returns the default when nothing exists", () => {
    process.chdir(dir);
    expect(resolveMigrationsDir()).toEqual({
      dir: join(dir, "migrations"),
      detected: false,
    });
  });

  test("create never auto-detects an ORM directory", () => {
    process.chdir(dir);
    mkdirSync(join(dir, "drizzle"));
    expect(resolveCreateMigrationsDir()).toBe(join(dir, "migrations"));
    expect(resolveCreateMigrationsDir("custom")).toBe(join(dir, "custom"));
  });
});

describe("migrationStatuses", () => {
  test("classifies applied, pending, modified, and missing", () => {
    write("0001_applied.sql", "SELECT 1;");
    write("0002_modified.sql", "SELECT 2;");
    write("0003_pending.sql", "SELECT 3;");
    const files = discoverMigrations(dir);

    const statuses = migrationStatuses(files, [
      {
        name: "0001_applied.sql",
        checksum: checksum("SELECT 1;"),
        applied_at: "2026-07-01 10:00:00",
      },
      {
        name: "0002_modified.sql",
        checksum: checksum("SELECT 999;"),
        applied_at: "2026-07-01 10:00:01",
      },
      {
        name: "0000_deleted.sql",
        checksum: "abc",
        applied_at: "2026-06-01 09:00:00",
      },
    ]);

    expect(statuses).toEqual([
      {
        name: "0001_applied.sql",
        state: "applied",
        appliedAt: "2026-07-01 10:00:00",
      },
      {
        name: "0002_modified.sql",
        state: "modified",
        appliedAt: "2026-07-01 10:00:01",
      },
      { name: "0003_pending.sql", state: "pending" },
      {
        name: "0000_deleted.sql",
        state: "missing",
        appliedAt: "2026-06-01 09:00:00",
      },
    ]);
  });

  test("marks a late-arriving file as out of order", () => {
    write("0001_late.sql", "SELECT 1;");
    write("0002_applied.sql", "SELECT 2;");
    const files = discoverMigrations(dir);

    expect(
      migrationStatuses(files, [
        {
          name: "0002_applied.sql",
          checksum: checksum("SELECT 2;"),
          applied_at: "now",
        },
      ]),
    ).toEqual([
      { name: "0001_late.sql", state: "out_of_order" },
      {
        name: "0002_applied.sql",
        state: "applied",
        appliedAt: "now",
      },
    ]);
  });
});

describe("migration history safety", () => {
  test("blocks modified, missing, and out-of-order histories", () => {
    const statuses = [
      { name: "0001.sql", state: "modified" as const },
      { name: "0002.sql", state: "missing" as const },
      { name: "0000.sql", state: "out_of_order" as const },
      { name: "0003.sql", state: "pending" as const },
    ];

    expect(migrationHistoryIssues(statuses)).toHaveLength(3);
    expect(() => assertMigrationHistorySafe(statuses, false)).toThrow(
      /Migration history needs attention/,
    );
    expect(() => assertMigrationHistorySafe(statuses, true)).not.toThrow();
  });

  test("accepts an ordinary applied and pending history", () => {
    expect(() =>
      assertMigrationHistorySafe(
        [
          { name: "0001.sql", state: "applied" },
          { name: "0002.sql", state: "pending" },
        ],
        false,
      ),
    ).not.toThrow();
  });
});

describe("pendingMigrations", () => {
  test("excludes applied files and keeps order", () => {
    write("0001_a.sql", "SELECT 1;");
    write("0002_b.sql", "SELECT 2;");
    write("0003_c.sql", "SELECT 3;");
    const files = discoverMigrations(dir);

    const pending = pendingMigrations(files, [
      { name: "0002_b.sql", checksum: "x", applied_at: "now" },
    ]);

    expect(pending.map((f) => f.name)).toEqual(["0001_a.sql", "0003_c.sql"]);
  });

  test("a modified file counts as applied, not pending", () => {
    write("0001_a.sql", "SELECT 1;");
    const files = discoverMigrations(dir);

    expect(
      pendingMigrations(files, [
        { name: "0001_a.sql", checksum: "stale", applied_at: "now" },
      ]),
    ).toEqual([]);
  });
});

describe("applyMigration", () => {
  test("runs the statements and records the migration", async () => {
    const client = memoryClient();
    await ensureMigrationsTable(client);

    write(
      "0001_users.sql",
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO users VALUES (1, 'Ada');",
    );
    const [file] = discoverMigrations(dir);
    if (!file) throw new Error("no migration discovered");

    const result = await applyMigration(client, file);
    expect(result.statements).toBe(2);

    const rows = await client.query("SELECT name FROM users");
    expect(rows).toHaveLength(1);

    const applied = await fetchApplied(client);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.name).toBe("0001_users.sql");
    expect(applied[0]?.checksum).toBe(file.checksum);
    expect(applied[0]?.applied_at).toBeTruthy();
  });

  test("records nothing when a statement fails", async () => {
    const client = memoryClient();
    await ensureMigrationsTable(client);

    write(
      "0001_broken.sql",
      "CREATE TABLE ok (id INTEGER);\nCREATE TABLE ok (id INTEGER);",
    );
    const [file] = discoverMigrations(dir);
    if (!file) throw new Error("no migration discovered");

    await expect(applyMigration(client, file)).rejects.toThrow();
    expect(await fetchApplied(client)).toEqual([]);

    const tables = await client.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'",
    );
    expect(tables).toHaveLength(0);
  });

  test("applying the same migration twice is rejected by the unique name", async () => {
    const client = memoryClient();
    await ensureMigrationsTable(client);

    write("0001_a.sql", "CREATE TABLE a (id INTEGER);");
    const [file] = discoverMigrations(dir);
    if (!file) throw new Error("no migration discovered");

    await applyMigration(client, file);
    await expect(applyMigration(client, file)).rejects.toThrow();
    expect(await fetchApplied(client)).toHaveLength(1);
  });

  test("defers foreign keys so table rebuilds work", async () => {
    const client = memoryClient();
    await ensureMigrationsTable(client);
    await client.query("PRAGMA foreign_keys = ON");
    await client.query("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
    await client.query(
      "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))",
    );
    await client.query("INSERT INTO parent VALUES (1)");
    await client.query("INSERT INTO child VALUES (1, 1)");

    write(
      "0001_rebuild.sql",
      [
        "CREATE TABLE parent_new (id INTEGER PRIMARY KEY, label TEXT);",
        "INSERT INTO parent_new (id) SELECT id FROM parent;",
        "DROP TABLE parent;",
        "ALTER TABLE parent_new RENAME TO parent;",
      ].join("\n"),
    );
    const [file] = discoverMigrations(dir);
    if (!file) throw new Error("no migration discovered");

    await applyMigration(client, file);

    const cols = await client.query("SELECT label FROM parent WHERE id = 1");
    expect(cols).toHaveLength(1);
  });

  test("applies valid SQL containing semicolons in quoted identifiers", async () => {
    const client = memoryClient();
    await ensureMigrationsTable(client);

    write(
      "0001_quoted.sql",
      'CREATE TABLE "semi;colon" (id INTEGER); INSERT INTO "semi;colon" VALUES (1);',
    );
    const [file] = discoverMigrations(dir);
    if (!file) throw new Error("no migration discovered");

    await applyMigration(client, file);
    const rows = await client.query('SELECT id FROM "semi;colon"');
    expect(rows).toHaveLength(1);
  });

  test("rejects a file with no statements", async () => {
    const client = memoryClient();
    await ensureMigrationsTable(client);

    write("0001_empty.sql", "-- nothing to do\n");
    const [file] = discoverMigrations(dir);
    if (!file) throw new Error("no migration discovered");

    await expect(applyMigration(client, file)).rejects.toThrow(
      /No SQL statements found/,
    );
  });

  test("reports parser errors with the migration filename", () => {
    write("0001_truncated.sql", "SELECT 1; /* never closed");
    const [file] = discoverMigrations(dir);
    if (!file) throw new Error("no migration discovered");

    expect(() => migrationStatements(file)).toThrow(
      /Could not parse 0001_truncated.sql: Unterminated block comment/,
    );
  });

  test("does not write or record a lexically invalid migration", async () => {
    const client = memoryClient();
    await ensureMigrationsTable(client);

    write(
      "0001_truncated.sql",
      "CREATE TABLE should_not_exist (id INTEGER); /* never closed",
    );
    const [file] = discoverMigrations(dir);
    if (!file) throw new Error("no migration discovered");

    await expect(applyMigration(client, file)).rejects.toThrow(
      /Unterminated block comment/,
    );
    expect(await fetchApplied(client)).toEqual([]);
    const table = await client.query(
      "SELECT name FROM sqlite_master WHERE name = 'should_not_exist'",
    );
    expect(table).toHaveLength(0);
  });
});

describe("migrationsTableExists", () => {
  test("false before the table is created, true after", async () => {
    const client = memoryClient();
    expect(await migrationsTableExists(client)).toBe(false);
    await ensureMigrationsTable(client);
    expect(await migrationsTableExists(client)).toBe(true);
  });
});

describe("readApplied", () => {
  test("returns empty without creating the table", async () => {
    const client = memoryClient();
    expect(await readApplied(client)).toEqual([]);
    expect(await migrationsTableExists(client)).toBe(false);
  });

  test("turns a connection failure into a hinted UserError", async () => {
    const broken: MigrationClient = {
      query: async () => {
        throw new Error("SERVER_ERROR: Server returned HTTP status 404");
      },
      batch: async () => {},
    };

    await expect(readApplied(broken)).rejects.toThrow(
      /Could not read migration state: SERVER_ERROR/,
    );
  });
});

describe("ensureMigrationsTable", () => {
  test("is idempotent and preserves rows", async () => {
    const client = memoryClient();
    await ensureMigrationsTable(client);

    write("0001_a.sql", "CREATE TABLE a (id INTEGER);");
    const [file] = discoverMigrations(dir);
    if (!file) throw new Error("no migration discovered");
    await applyMigration(client, file);

    await ensureMigrationsTable(client);
    expect(await fetchApplied(client)).toHaveLength(1);
  });

  test("refuses a table name that isn't a bare identifier", async () => {
    const client = memoryClient();
    await expect(
      ensureMigrationsTable(client, 'x"; DROP TABLE users; --'),
    ).rejects.toThrow(/Invalid table name/);
  });
});
