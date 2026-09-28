/**
 * The slice of a database connection this adapter needs. `Database` from
 * `@bunny.net/database-client` satisfies it; tests back it with `bun:sqlite`
 * so introspection runs against a real SQLite engine.
 */
export interface AdapterClient {
  prepare(sql: string): AdapterStatement;
}

export interface AdapterStatement {
  bind(...values: unknown[]): AdapterStatement;
  run(): Promise<{ rows: Record<string, unknown>[]; columns: string[] }>;
}
