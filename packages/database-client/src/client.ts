import { ENV_DATABASE_AUTH_TOKEN, ENV_DATABASE_URL, readEnv } from "./env.ts";
import { DatabaseError } from "./errors.ts";
import {
  createTransport,
  decodeValue,
  encodeValue,
  type SqlValue,
  type Transport,
  type TransportConfig,
  unwrap,
  type WireBatchResult,
  type WireStmtResult,
  type WireValue,
} from "./protocol.ts";

export type Row = Record<string, SqlValue>;

/** Full result of one statement. */
export interface Result<T = Row> {
  rows: T[];
  columns: string[];
  rowsAffected: number;
  lastInsertRowid: number | bigint | null;
}

export interface Config extends TransportConfig {
  /** Abort signal applied to every request unless a per-call signal is given. */
  signal?: AbortSignal;
}

interface StatementInternals {
  sql: string;
  args: WireValue[];
  transport: Transport;
  signal?: AbortSignal;
}

function toResult<T>(wire: WireStmtResult): Result<T> {
  const columns = wire.cols.map(
    (col, index) => col.name ?? `column${index + 1}`,
  );
  const rows = wire.rows.map((row) => {
    // Null prototype so a column named __proto__ (or constructor, toString, ...) is a plain own property.
    const out: Row = Object.create(null);
    for (let i = 0; i < columns.length; i++)
      out[columns[i] as string] = decodeValue(row[i] as WireValue);
    return out as T;
  });
  return {
    rows,
    columns,
    rowsAffected: wire.affected_row_count,
    lastInsertRowid:
      wire.last_insert_rowid === null
        ? null
        : (decodeValue({ type: "integer", value: wire.last_insert_rowid }) as
            | number
            | bigint),
  };
}

/** A SQL statement plus its bound arguments. Immutable and reusable. */
export class Statement {
  readonly #internals: StatementInternals;

  constructor(internals: StatementInternals) {
    this.#internals = internals;
  }

  /** Return a copy of this statement with `values` bound to its `?` placeholders. */
  bind(...values: unknown[]): Statement {
    return new Statement({ ...this.#internals, args: values.map(encodeValue) });
  }

  /** Execute and return every row as an object. */
  async all<T = Row>(): Promise<T[]> {
    return (await this.run<T>()).rows;
  }

  /** Execute and return the first row, or the value of one column of it. */
  async first<T = Row>(): Promise<T | null>;
  async first(column: string): Promise<SqlValue | null>;
  async first<T = Row>(column?: string): Promise<T | SqlValue | null> {
    const result = await this.run<Row>();
    const row = result.rows[0];
    if (!row) return null;
    if (column === undefined) return row as T;
    if (!Object.hasOwn(row, column)) {
      throw new DatabaseError(
        `column "${column}" is not in the result; got ${result.columns.join(", ")}`,
        "COLUMN_NOT_FOUND",
      );
    }
    return row[column] as SqlValue;
  }

  /** Execute and return rows as positional arrays, skipping object construction. */
  async raw(): Promise<SqlValue[][]> {
    const wire = await this.#execute();
    return wire.rows.map((row) => row.map(decodeValue));
  }

  /** Execute and return rows together with write metadata. */
  async run<T = Row>(): Promise<Result<T>> {
    return toResult<T>(await this.#execute());
  }

  /** @internal exposed so `batch()` can read the wire form. */
  get wire(): { sql: string; args: WireValue[]; want_rows: boolean } {
    return {
      sql: this.#internals.sql,
      args: this.#internals.args,
      want_rows: true,
    };
  }

  async #execute(): Promise<WireStmtResult> {
    const { transport, signal } = this.#internals;
    const results = await transport.send(
      [{ type: "execute", stmt: this.wire }],
      signal,
    );
    return unwrap<WireStmtResult>(results[0]);
  }
}

/** A connection to a bunny.net database. Stateless: each call is one HTTPS request. */
export class Database {
  readonly #transport: Transport;
  readonly #signal?: AbortSignal;

  constructor(config: Config) {
    if (!config.url) throw new DatabaseError("url is required", "URL_INVALID");
    this.#transport = createTransport(config);
    this.#signal = config.signal;
  }

  /** Create a statement from SQL. Bind arguments with `.bind()`. */
  prepare(sql: string): Statement {
    return new Statement({
      sql,
      args: [],
      transport: this.#transport,
      signal: this.#signal,
    });
  }

  /** Run every statement in one transaction. All succeed or none are applied. */
  async batch<T = Row>(statements: Statement[]): Promise<Result<T>[]> {
    if (statements.length === 0) return [];

    const control = (sql: string, condition?: unknown) => ({
      stmt: { sql, args: [], want_rows: false },
      ...(condition ? { condition } : {}),
    });

    const steps = [
      control("BEGIN"),
      ...statements.map((statement, index) => ({
        stmt: statement.wire,
        condition: { type: "ok", step: index },
      })),
      control("COMMIT", { type: "ok", step: statements.length }),
      control("ROLLBACK", {
        type: "not",
        cond: { type: "ok", step: statements.length + 1 },
      }),
    ];

    const results = await this.#transport.send(
      [{ type: "batch", batch: { steps } }],
      this.#signal,
    );
    const batch = unwrap<WireBatchResult>(results[0]);

    const failure = batch.step_errors.find((error) => error !== null);
    if (failure) throw DatabaseError.fromWire(failure);

    return statements.map((_, index) => {
      const step = batch.step_results[index + 1];
      if (!step) throw new DatabaseError("batch step returned no result");
      return toResult<T>(step);
    });
  }

  /** Run a multi-statement SQL script. No parameters, no rows returned. */
  async exec(sql: string): Promise<void> {
    const results = await this.#transport.send(
      [{ type: "sequence", sql }],
      this.#signal,
    );
    unwrap<null>(results[0]);
  }
}

/**
 * Connect to a bunny.net database.
 *
 * `url` and `authToken` fall back to `BUNNY_DATABASE_URL` and
 * `BUNNY_DATABASE_AUTH_TOKEN`, so `connect()` with no arguments is enough
 * wherever the CLI or Edge Scripting has already put them in the environment.
 */
export function connect(config: Partial<Config> = {}): Database {
  const url = config.url ?? readEnv(ENV_DATABASE_URL);
  if (!url) {
    throw new DatabaseError(
      `no database URL: pass { url } or set ${ENV_DATABASE_URL}`,
      "URL_MISSING",
    );
  }
  return new Database({
    ...config,
    url,
    authToken: config.authToken ?? readEnv(ENV_DATABASE_AUTH_TOKEN),
  });
}
