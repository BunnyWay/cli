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
  type WireNamedArg,
  type WireStmt,
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

/** Same as `Result`, with rows as positional arrays so duplicate column names survive. */
export interface RawResult extends Omit<Result<never>, "rows"> {
  rows: SqlValue[][];
}

export interface Config extends TransportConfig {
  /** Abort signal applied to every request unless a per-call signal is given. */
  signal?: AbortSignal;
}

/** Options for `batch()` and `batchRaw()`. */
export interface BatchOptions {
  /** Enforce foreign key constraints. Pass `false` for schema changes that rebuild tables. */
  foreignKeys?: boolean;
}

interface StatementInternals {
  sql: string;
  args: WireValue[];
  namedArgs: WireNamedArg[];
  transport: Transport;
  signal?: AbortSignal;
}

/** A single plain object argument means named parameters; everything else binds positionally. */
function isNamedArgs(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toRawResult(wire: WireStmtResult): RawResult {
  return {
    rows: wire.rows.map((row) => row.map(decodeValue)),
    columns: wire.cols.map((col, index) => col.name ?? `column${index + 1}`),
    rowsAffected: wire.affected_row_count,
    lastInsertRowid:
      wire.last_insert_rowid === null
        ? null
        : (decodeValue({ type: "integer", value: wire.last_insert_rowid }) as
            | number
            | bigint),
  };
}

function toResult<T>(wire: WireStmtResult): Result<T> {
  const raw = toRawResult(wire);
  const rows = raw.rows.map((row) => {
    // Null prototype so a column named __proto__ (or constructor, toString, ...) is a plain own property.
    const out: Row = Object.create(null);
    for (let i = 0; i < raw.columns.length; i++)
      out[raw.columns[i] as string] = row[i] as SqlValue;
    return out as T;
  });
  return { ...raw, rows } as Result<T>;
}

/** A SQL statement plus its bound arguments. Immutable and reusable. */
export class Statement {
  readonly #internals: StatementInternals;

  constructor(internals: StatementInternals) {
    this.#internals = internals;
  }

  /** Return a copy of this statement with `values` bound: positionally for `?`, or one object for `:name`, `@name`, and `$name`. */
  bind(...values: unknown[]): Statement {
    const named = values.find(isNamedArgs);
    if (named && values.length > 1) {
      throw new DatabaseError(
        "cannot mix positional and named parameters; pass a list of values or a single object",
        "ARGUMENT_INVALID",
      );
    }
    if (named) {
      return new Statement({
        ...this.#internals,
        args: [],
        // The server resolves a bare name against :name, @name, and $name, so the sigil is optional.
        namedArgs: Object.entries(named).map(([name, value]) => ({
          name,
          value: encodeValue(value),
        })),
      });
    }
    return new Statement({
      ...this.#internals,
      args: values.map(encodeValue),
      namedArgs: [],
    });
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
    return (await this.runRaw()).rows;
  }

  /** Execute and return positional rows with write metadata. Keeps duplicate column names distinct. */
  async runRaw(): Promise<RawResult> {
    return toRawResult(await this.#execute());
  }

  /** Execute and return rows together with write metadata. */
  async run<T = Row>(): Promise<Result<T>> {
    return toResult<T>(await this.#execute());
  }

  /** @internal exposed so `batch()` can read the wire form. */
  get wire(): WireStmt {
    return {
      sql: this.#internals.sql,
      args: this.#internals.args,
      named_args: this.#internals.namedArgs,
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
      namedArgs: [],
      transport: this.#transport,
      signal: this.#signal,
    });
  }

  /** Build a statement from a template literal, binding every interpolated value positionally. */
  sql(strings: TemplateStringsArray, ...values: unknown[]): Statement {
    // Binding here rather than through bind() keeps an interpolated object a rejected value instead of named parameters.
    return new Statement({
      sql: strings.join("?"),
      args: values.map(encodeValue),
      namedArgs: [],
      transport: this.#transport,
      signal: this.#signal,
    });
  }

  /** Run every statement in one transaction. All succeed or none are applied. */
  async batch<T = Row>(
    statements: Statement[],
    options: BatchOptions = {},
  ): Promise<Result<T>[]> {
    return (await this.#batch(statements, options)).map((wire) =>
      toResult<T>(wire),
    );
  }

  /** Like `batch()`, but each result has positional rows. Keeps duplicate column names distinct. */
  async batchRaw(
    statements: Statement[],
    options: BatchOptions = {},
  ): Promise<RawResult[]> {
    return (await this.#batch(statements, options)).map(toRawResult);
  }

  async #batch(
    statements: Statement[],
    options: BatchOptions,
  ): Promise<WireStmtResult[]> {
    if (statements.length === 0) return [];

    const control = (sql: string, condition?: unknown) => ({
      stmt: { sql, args: [], named_args: [], want_rows: false },
      ...(condition ? { condition } : {}),
    });

    // SQLite ignores `PRAGMA foreign_keys` inside a transaction, so the pragmas
    // bracket BEGIN/COMMIT instead of sitting within them.
    const unchecked = options.foreignKeys === false;
    const prelude = unchecked ? [control("PRAGMA foreign_keys=off")] : [];
    const begin = prelude.length;
    const last = begin + statements.length;

    // BEGIN is already DEFERRED in SQLite, so naming the mode would change nothing.
    const steps = [
      ...prelude,
      control("BEGIN"),
      ...statements.map((statement, index) => ({
        stmt: statement.wire,
        condition: { type: "ok", step: begin + index },
      })),
      control("COMMIT", { type: "ok", step: last }),
      control("ROLLBACK", {
        type: "not",
        cond: { type: "ok", step: last + 1 },
      }),
      // Matches @libsql/client, which hardcodes `on` too; harmless here because the stream closes in this same request.
      ...(unchecked ? [control("PRAGMA foreign_keys=on")] : []),
    ];

    const results = await this.#transport.send(
      [{ type: "batch", batch: { steps } }],
      this.#signal,
    );
    const batch = unwrap<WireBatchResult>(results[0]);

    const failure = batch.step_errors.find((error) => error !== null);
    if (failure) throw DatabaseError.fromWire(failure);

    return statements.map((_, index) => {
      const step = batch.step_results[begin + 1 + index];
      if (!step) throw new DatabaseError("batch step returned no result");
      return step;
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
