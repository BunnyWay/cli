import {
  connect,
  type Database,
  type RawResult,
} from "@bunny.net/database-client";
import pkg from "../package.json";

const USER_AGENT = `bunny-database-shell/${pkg.version}`;

/**
 * The slice of a database connection the shell needs: run one statement, or a
 * file's worth of them in a transaction. Rows stay positional so a result with
 * two columns of the same name (`SELECT * FROM a JOIN b`) still prints both.
 */
export interface ShellClient {
  execute(sql: string): Promise<RawResult>;
  batch(statements: string[]): Promise<RawResult[]>;
}

/** Connect to a database, tagging requests with a `User-Agent` we can identify server-side. */
export function createShellClient(opts: {
  url: string;
  authToken?: string;
  userAgent?: string;
}): ShellClient {
  const { userAgent = USER_AGENT, ...config } = opts;
  return fromDatabase(
    connect({ ...config, headers: { "User-Agent": userAgent } }),
  );
}

/** Wrap an existing connection, so a caller that already has one can reuse it. */
export function fromDatabase(db: Database): ShellClient {
  return {
    execute: (sql) => db.prepare(sql).runRaw(),
    batch: (statements) =>
      db.batchRaw(statements.map((sql) => db.prepare(sql))),
  };
}
