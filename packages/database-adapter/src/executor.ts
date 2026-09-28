import type { DatabaseExecutor, ExecuteResult } from "@bunny.net/database-rest";
import type { AdapterClient } from "./client.ts";

export interface CreateExecutorOptions {
  client: AdapterClient;
}

export const createExecutor = ({
  client,
}: CreateExecutorOptions): DatabaseExecutor => ({
  execute: async (sql, args): Promise<ExecuteResult> => {
    const result = await client
      .prepare(sql)
      .bind(...args)
      .run();
    return { columns: result.columns, rows: result.rows };
  },
});
