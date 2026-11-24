export type SqlArg = string | number | boolean | null;

export interface ExecuteResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

/** One parameterized statement inside `DatabaseExecutor.batch()`. */
export interface BatchStatement {
  sql: string;
  args: SqlArg[];
}

export interface DatabaseExecutor {
  execute(sql: string, args: SqlArg[]): Promise<ExecuteResult>;
  /**
   * Run every statement in one transaction: all commit or none do, and the
   * promise rejects with the failing statement's error. Results come back in
   * statement order. Optional, because not every executor can offer
   * atomicity; callers that need it should check for it rather than falling
   * back to sequential `execute()` calls.
   */
  batch?(statements: BatchStatement[]): Promise<ExecuteResult[]>;
}
