import { ENV_DATABASE_AUTH_TOKEN, ENV_DATABASE_URL, readEnv } from "./env.ts";
import { DatabaseError } from "./errors.ts";
import {
  createTransport,
  decodeInteger,
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
export type RawResult = Result<SqlValue[]>;

export interface Config extends TransportConfig {
  /** Abort signal applied to every request this connection makes. */
  signal?: AbortSignal;
}

/** How the batch transaction takes its lock. `immediate` reserves the write lock up front so a batch that reads then writes cannot lose to another writer. */
export type BatchMode = "deferred" | "immediate" | "exclusive";

/** Options for `batch()` and `batchRaw()`. */
export interface BatchOptions {
  /** Enforce foreign key constraints. Pass `false` for schema changes that rebuild tables. */
  foreignKeys?: boolean;
  /** Transaction locking mode. Defaults to `deferred`, SQLite's own default. */
  mode?: BatchMode;
}

const TRANSACTION_KEYWORDS = new Set(["BEGIN", "COMMIT", "END", "ROLLBACK"]);

/** First keyword of a statement, skipping leading whitespace, semicolons, and comments. */
function firstKeyword(sql: string): string | undefined {
  const stripped = sql.replace(/^(\s|;|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, "");
  return /^[A-Za-z]+/.exec(stripped)?.[0].toUpperCase();
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
        : decodeInteger(wire.last_insert_rowid),
  };
}

/** Zip one positional row with its column names. Null prototype so a column named __proto__ (or constructor, toString, ...) is a plain own property. */
function toRow(columns: string[], values: SqlValue[]): Row {
  const row: Row = Object.create(null);
  columns.forEach((name, i) => {
    row[name] = values[i] as SqlValue;
  });
  return row;
}

function toResult<T>(wire: WireStmtResult): Result<T> {
  const raw = toRawResult(wire);
  return {
    ...raw,
    rows: raw.rows.map((values) => toRow(raw.columns, values) as T),
  };
}

/** A SQL statement plus its bound arguments. Immutable and reusable. `T` is the row shape its executors return. */
export class Statement<T = Row> {
  readonly #internals: StatementInternals;

  /** @internal Statements come from `Database.prepare()` and `Database.sql`. */
  constructor(internals: StatementInternals) {
    this.#internals = internals;
  }

  /** Return a copy of this statement with `values` bound: positionally for `?`, or one object for `:name`, `@name`, and `$name`. */
  bind(...values: unknown[]): Statement<T> {
    const named = values.find(isNamedArgs);
    if (named && values.length > 1) {
      throw new DatabaseError(
        "cannot mix positional and named parameters; pass a list of values or a single object",
        { code: "ARGUMENT_INVALID" },
      );
    }
    return new Statement<T>({
      ...this.#internals,
      args: named ? [] : values.map(encodeValue),
      // The server resolves a bare name against :name, @name, and $name, so the sigil is optional.
      namedArgs: named
        ? Object.entries(named).map(([name, value]) => ({
            name,
            value: encodeValue(value),
          }))
        : [],
    });
  }

  /** Execute and return every row as an object. */
  async all<R = T>(): Promise<R[]> {
    return (await this.run<R>()).rows;
  }

  /** Execute and return the first row, or the value of one column of it. */
  async first<R = T>(): Promise<R | null>;
  async first(column: string): Promise<SqlValue | null>;
  async first<R = T>(column?: string): Promise<R | SqlValue | null> {
    const result = await this.run<Row>();
    const row = result.rows[0];
    if (!row) return null;
    if (column === undefined) return row as R;
    if (!Object.hasOwn(row, column)) {
      throw new DatabaseError(
        `column "${column}" is not in the result; got ${result.columns.join(", ")}`,
        { code: "COLUMN_NOT_FOUND" },
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
  async run<R = T>(): Promise<Result<R>> {
    return toResult<R>(await this.#execute());
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

/** Maps each statement in a batch to the `Result` of its row type. */
export type BatchResults<T extends readonly Statement<unknown>[]> = {
  -readonly [K in keyof T]: T[K] extends Statement<infer R> ? Result<R> : never;
};

/** A connection to a bunny.net database. Stateless: each call is one HTTPS request. */
export class Database {
  readonly #transport: Transport;
  readonly #signal?: AbortSignal;

  constructor(config: Config) {
    if (!config.url)
      throw new DatabaseError("url is required", { code: "URL_INVALID" });
    this.#transport = createTransport(config);
    this.#signal = config.signal;
  }

  #statement<T>(sql: string, args: WireValue[]): Statement<T> {
    return new Statement<T>({
      sql,
      args,
      namedArgs: [],
      transport: this.#transport,
      signal: this.#signal,
    });
  }

  /** Create a statement from SQL. Bind arguments with `.bind()`. Pass `T` to type every row it returns. */
  prepare<T = Row>(sql: string): Statement<T> {
    return this.#statement<T>(sql, []);
  }

  /** Build a statement from a template literal, binding every interpolated value positionally. Pass `T` to type its rows. */
  sql<T = Row>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Statement<T> {
    // Binding here rather than through bind() keeps an interpolated object a rejected value instead of named parameters.
    return this.#statement<T>(strings.join("?"), values.map(encodeValue));
  }

  /** Run every statement in one transaction. All succeed or none are applied. */
  async batch<T extends readonly Statement<unknown>[]>(
    statements: [...T],
    options: BatchOptions = {},
  ): Promise<BatchResults<T>> {
    return (await this.#batch(statements, options)).map((wire) =>
      toResult<Row>(wire),
    ) as BatchResults<T>;
  }

  /** Like `batch()`, but each result has positional rows. Keeps duplicate column names distinct. */
  async batchRaw(
    statements: readonly Statement<unknown>[],
    options: BatchOptions = {},
  ): Promise<RawResult[]> {
    return (await this.#batch(statements, options)).map(toRawResult);
  }

  async #batch(
    statements: readonly Statement<unknown>[],
    options: BatchOptions,
  ): Promise<WireStmtResult[]> {
    if (statements.length === 0) return [];

    // A caller's own BEGIN or COMMIT would break the transaction the batch wraps around it.
    statements.forEach((statement, index) => {
      const keyword = firstKeyword(statement.wire.sql);
      if (keyword && TRANSACTION_KEYWORDS.has(keyword)) {
        throw new DatabaseError(
          `statement ${index} starts with ${keyword}; batch() already runs its statements in one transaction`,
          { code: "ARGUMENT_INVALID", batchIndex: index },
        );
      }
    });

    const control = (sql: string, condition?: unknown) => ({
      stmt: { sql, args: [], named_args: [], want_rows: false },
      ...(condition ? { condition } : {}),
    });
    const ok = (step: number) => ({ type: "ok", step });

    // SQLite ignores `PRAGMA foreign_keys` inside a transaction, so the pragmas
    // bracket BEGIN/COMMIT instead of sitting within them.
    const unchecked = options.foreignKeys === false;
    const prelude = unchecked ? [control("PRAGMA foreign_keys=off")] : [];
    const begin = prelude.length;
    const first = begin + 1;
    const last = begin + statements.length;
    const commit = last + 1;

    const steps = [
      ...prelude,
      control(`BEGIN ${(options.mode ?? "deferred").toUpperCase()}`),
      ...statements.map((statement, index) => ({
        stmt: statement.wire,
        condition: ok(begin + index),
      })),
      control("COMMIT", ok(last)),
      // Only roll back a transaction this batch opened, and only when it did not commit.
      control("ROLLBACK", {
        type: "and",
        conds: [ok(begin), { type: "not", cond: ok(commit) }],
      }),
      // Hardcoded `on` is harmless here because the stream closes in this same request.
      ...(unchecked ? [control("PRAGMA foreign_keys=on")] : []),
    ];

    const results = await this.#transport.send(
      [{ type: "batch", batch: { steps } }],
      this.#signal,
    );
    const batch = unwrap<WireBatchResult>(results[0]);

    // Steps fail in order (the chain stops at the first error), so the first error is the cause.
    const failed = batch.step_errors.findIndex((error) => error != null);
    if (failed !== -1) {
      const index = failed - first;
      throw DatabaseError.fromWire(
        batch.step_errors[failed] ?? undefined,
        index >= 0 && index < statements.length ? index : undefined,
      );
    }

    return statements.map((_, index) => {
      const step = batch.step_results[first + index];
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
  const url = config.url || readEnv(ENV_DATABASE_URL);
  if (!url) {
    throw new DatabaseError(
      `no database URL: pass { url } or set ${ENV_DATABASE_URL}`,
      { code: "URL_MISSING" },
    );
  }
  return new Database({
    ...config,
    url,
    authToken: config.authToken ?? readEnv(ENV_DATABASE_AUTH_TOKEN),
  });
}
