import { connect, type Database } from "@bunny.net/database-client";
import type { MigrationClient } from "./engine.ts";

/** Adapt a connection to the engine's surface, keeping `migrate()` semantics intact. */
export function migrationClient(db: Database): MigrationClient {
  return {
    execute: (statement) => {
      const { sql, args } =
        typeof statement === "string"
          ? { sql: statement, args: [] }
          : statement;
      return db
        .prepare(sql)
        .bind(...args)
        .run();
    },
    migrate: (statements) =>
      db.migrate(
        statements.map(({ sql, args }) =>
          db.prepare(sql).bind(...(args ?? [])),
        ),
      ),
  };
}

/** Connect to a database and adapt it for the migration engine. */
export function connectForMigrations(opts: {
  url: string;
  authToken?: string;
}): MigrationClient {
  return migrationClient(connect(opts));
}
