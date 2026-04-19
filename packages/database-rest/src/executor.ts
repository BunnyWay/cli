export interface ExecuteResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface DatabaseExecutor {
  execute(
    sql: string,
    args: (string | number | boolean | null)[],
  ): Promise<ExecuteResult>;
}
