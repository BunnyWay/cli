import {
  DEFAULT_EXCLUDE_PATTERNS,
  shouldInclude,
} from "@bunny.net/database-adapter";
import type { Database } from "@bunny.net/database-client";

export interface ViewDefinition {
  name: string;
  sql: string | null;
  columns: string[];
}

export interface Catalog {
  /** Each table's CREATE statements: the table first, then its indexes and triggers. */
  ddl: Record<string, string[]>;
  views: ViewDefinition[];
}

type CatalogClient = Pick<Database, "prepare">;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

const excluded = (name: string) =>
  name.startsWith("sqlite_") || !shouldInclude(name, DEFAULT_EXCLUDE_PATTERNS);

/**
 * A view's columns, or none when SQLite can't resolve it (a view over a
 * dropped table): one stale view must not stop studio from starting.
 */
async function viewColumns(
  client: CatalogClient,
  name: string,
): Promise<string[]> {
  try {
    const info = await client
      .prepare(`PRAGMA table_info(${quote(name)})`)
      .run();
    return info.rows.map((r) => String(r.name));
  } catch {
    return [];
  }
}

/**
 * What introspection leaves out and the schema view wants: the CREATE
 * statements as written (including triggers, which introspection doesn't
 * read), and views with their columns.
 */
export async function loadCatalog(
  client: CatalogClient,
  tableNames: Set<string>,
): Promise<Catalog> {
  const { rows } = await client
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name",
    )
    .run();

  const ddl: Record<string, string[]> = {};
  const views: ViewDefinition[] = [];

  for (const row of rows) {
    const type = String(row.type);
    const name = String(row.name);
    const table = String(row.tbl_name);
    const sql = row.sql === null ? null : String(row.sql);

    if (type === "view") {
      if (excluded(name)) continue;
      views.push({ name, sql, columns: await viewColumns(client, name) });
    } else if (tableNames.has(table) && sql) {
      ddl[table] ??= [];
      ddl[table].push(sql);
    }
  }

  return { ddl, views };
}
