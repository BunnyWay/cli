import type { Database } from "bun:sqlite";
import type {
  AdapterClient,
  AdapterResult,
  AdapterStatement,
} from "./client.ts";

/**
 * Back the adapter surface with a local SQLite file or `:memory:`. Bun-only, and
 * meant for tests and the local playground; production goes through the HTTP client.
 */
export function sqliteClient(db: Database): AdapterClient {
  // batch() runs inside a synchronous bun:sqlite transaction, so it needs each
  // statement's SQL and values, not the async run() the public surface offers.
  const pending = new WeakMap<
    AdapterStatement,
    { sql: string; values: unknown[] }
  >();

  const runSync = (sql: string, values: unknown[]): AdapterResult => {
    const query = db.query(sql);
    const rows = query.all(...(values as never[])) as Record<string, unknown>[];

    return { rows, columns: query.columnNames };
  };

  const statement = (sql: string, values: unknown[]): AdapterStatement => {
    const created: AdapterStatement = {
      bind: (...next: unknown[]) => statement(sql, next),
      run: async () => runSync(sql, values),
    };
    pending.set(created, { sql, values });

    return created;
  };

  return {
    prepare: (sql) => statement(sql, []),
    batch: async (statements, options = {}) => {
      const parts = statements.map((created) => {
        const part = pending.get(created);
        if (!part) {
          throw new Error(
            "sqliteClient.batch() only accepts statements from its own prepare()",
          );
        }

        return part;
      });
      const transaction = db.transaction(() =>
        parts.map(({ sql, values }) => runSync(sql, values)),
      );

      return transaction[options.mode ?? "deferred"]();
    },
  };
}
