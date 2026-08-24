import { connect } from "@bunny.net/database-client";
import { VERSION } from "../../../core/version.ts";
import type { MigrationClient } from "./engine.ts";

/** Connect to a database and adapt it to the engine's surface, applying migrations with foreign keys off. */
export function connectForMigrations(opts: {
  url: string;
  authToken: string;
}): MigrationClient {
  const db = connect({
    ...opts,
    headers: { "User-Agent": `bunny-cli/${VERSION}` },
  });

  return {
    query: (sql, args = []) =>
      db
        .prepare(sql)
        .bind(...args)
        .all(),
    batch: async (statements) => {
      await db.batch(
        statements.map(({ sql, args }) =>
          db.prepare(sql).bind(...(args ?? [])),
        ),
        { foreignKeys: false },
      );
    },
  };
}
