import type { Database } from "bun:sqlite";
import type { AdapterClient, AdapterStatement } from "./client.ts";

/**
 * Back the adapter surface with a local SQLite file or `:memory:`. Bun-only, and
 * meant for tests and the local playground; production goes through the HTTP client.
 */
export function sqliteClient(db: Database): AdapterClient {
  const statement = (sql: string, values: unknown[]): AdapterStatement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => {
      const query = db.query(sql);
      const rows = query.all(...(values as never[])) as Record<
        string,
        unknown
      >[];
      return { rows, columns: query.columnNames };
    },
  });
  return { prepare: (sql) => statement(sql, []) };
}
