import type { Client } from "@libsql/client";
import type { DatabaseExecutor, ExecuteResult } from "@bunny.net/database-rest";

export const createLibSQLExecutor = (client: Client): DatabaseExecutor => ({
  execute: async (sql, args): Promise<ExecuteResult> => {
    const result = await client.execute({ sql, args });
    return {
      columns: result.columns,
      rows: result.rows as Record<string, unknown>[],
    };
  },
});
