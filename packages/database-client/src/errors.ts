import { ENV_DATABASE_AUTH_TOKEN } from "./env.ts";

export interface DatabaseErrorOptions {
  code?: string;
  status?: number;
  batchIndex?: number;
  cause?: unknown;
}

/** Fetch rejections that mean the request never completed, keyed by the error name each runtime uses. */
const TRANSPORT_FAILURES: Record<string, { message: string; code: string }> = {
  TimeoutError: { message: "database request timed out", code: "TIMEOUT" },
  AbortError: { message: "database request was aborted", code: "ABORTED" },
};

export class DatabaseError extends Error {
  override readonly name = "DatabaseError";

  /** SQLite/hrana error code (e.g. `SQLITE_CONSTRAINT`), or a client code such as `TIMEOUT`. */
  readonly code?: string;

  /** HTTP status when the failure came from the transport rather than SQL. */
  readonly status?: number;

  /** Zero-based position of the statement that failed inside `batch()`, when one of the caller's statements did. */
  readonly batchIndex?: number;

  constructor(message: string, options: DatabaseErrorOptions = {}) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = options.code;
    this.status = options.status;
    this.batchIndex = options.batchIndex;
  }

  static fromWire(
    error: { message: string; code?: string | null } | undefined,
    batchIndex?: number,
  ): DatabaseError {
    return new DatabaseError(error?.message ?? "unknown database error", {
      code: error?.code ?? undefined,
      batchIndex,
    });
  }

  /** Classify a failure that happened before any SQL ran: an aborted, timed out, or unreachable request. */
  static fromTransport(cause: unknown): DatabaseError {
    if (cause instanceof DatabaseError) return cause;
    const { name, message } = (cause ?? {}) as {
      name?: string;
      message?: string;
    };
    const known = name === undefined ? undefined : TRANSPORT_FAILURES[name];
    if (known)
      return new DatabaseError(known.message, { code: known.code, cause });
    return new DatabaseError(
      `could not reach the database${message ? `: ${message}` : ""}`,
      { code: "NETWORK", cause },
    );
  }

  static fromHttp(status: number, body: string): DatabaseError {
    let message = `database request failed with HTTP ${status}`;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object") {
        const { error, message: text } = parsed as {
          error?: unknown;
          message?: unknown;
        };
        if (error || text) message = String(error ?? text);
      }
    } catch {
      if (body.trim()) message = body.trim().slice(0, 300);
    }
    if (status === 401 || status === 403) {
      return new DatabaseError(
        `${message} (check the auth token, or set ${ENV_DATABASE_AUTH_TOKEN})`,
        { code: "UNAUTHORIZED", status },
      );
    }
    return new DatabaseError(message, { status });
  }
}
