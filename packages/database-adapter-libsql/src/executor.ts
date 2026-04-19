import type { DatabaseExecutor, ExecuteResult } from "@bunny.net/database-rest";
import type { Client } from "@libsql/client";

export interface CreateLibSQLExecutorOptions {
  client: Client;
}

export const createLibSQLExecutor = ({
  client,
}: CreateLibSQLExecutorOptions): DatabaseExecutor => ({
  execute: async (sql, args): Promise<ExecuteResult> => {
    const result = await client.execute({ sql, args });
    return {
      columns: result.columns,
      rows: result.rows as Record<string, unknown>[],
    };
  },
});
