/**
 * The slice of a database connection this adapter needs. `Database` from
 * `@bunny.net/database-client` satisfies it; tests back it with `bun:sqlite`
 * so introspection runs against a real SQLite engine.
 */
export interface AdapterClient {
  prepare(sql: string): AdapterStatement;
  /**
   * Run statements from this client's `prepare()` in one transaction. When
   * present, `createExecutor` exposes it as `DatabaseExecutor.batch()`.
   */
  batch?(
    statements: AdapterStatement[],
    options?: { mode?: AdapterBatchMode },
  ): Promise<AdapterBatchResult[]>;
}

/** How a batch takes its lock. Matches `BatchMode` in `@bunny.net/database-client`. */
export type AdapterBatchMode = "deferred" | "immediate" | "exclusive";

export interface AdapterResult {
  rows: Record<string, unknown>[];
  columns: string[];
}

/**
 * `Database.batch()` infers each row type from its statements, which are
 * `Statement<unknown>` here, so rows arrive typed as `unknown`. They are
 * column-keyed objects at runtime, the same as `run()` returns.
 */
export interface AdapterBatchResult {
  rows: unknown[];
  columns: string[];
}

export interface AdapterStatement {
  bind(...values: unknown[]): AdapterStatement;
  run(): Promise<AdapterResult>;
}
