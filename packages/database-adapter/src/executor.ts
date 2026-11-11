import type { DatabaseExecutor, ExecuteResult } from "@bunny.net/database-rest";
import type {
  AdapterBatchResult,
  AdapterClient,
  AdapterResult,
} from "./client.ts";

export interface CreateExecutorOptions {
  client: AdapterClient;
}

const toExecuteResult = ({ columns, rows }: AdapterResult): ExecuteResult => ({
  columns,
  rows,
});

export const createExecutor = ({
  client,
}: CreateExecutorOptions): DatabaseExecutor => {
  const executor: DatabaseExecutor = {
    execute: async (sql, args) => {
      const result = await client
        .prepare(sql)
        .bind(...args)
        .run();

      return toExecuteResult(result);
    },
  };

  const { batch } = client;
  if (batch) {
    // Batches exist to make writes atomic, so take the write lock up front:
    // a batch that reads then writes cannot then lose to another writer.
    executor.batch = async (statements) => {
      const prepared = statements.map(({ sql, args }) =>
        client.prepare(sql).bind(...args),
      );
      const results = await batch.call(client, prepared, { mode: "immediate" });

      return results.map(({ columns, rows }: AdapterBatchResult) =>
        toExecuteResult({ columns, rows: rows as AdapterResult["rows"] }),
      );
    };
  }

  return executor;
};
