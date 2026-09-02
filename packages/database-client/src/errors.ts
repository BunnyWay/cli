import { ENV_DATABASE_AUTH_TOKEN } from "./env.ts";

export interface DatabaseErrorOptions {
  code?: string;
  status?: number;
  cause?: unknown;
}

export class DatabaseError extends Error {
  override readonly name = "DatabaseError";

  /** SQLite/hrana error code (e.g. `SQLITE_CONSTRAINT`), or a client code such as `TIMEOUT`. */
  readonly code?: string;

  /** HTTP status when the failure came from the transport rather than SQL. */
  readonly status?: number;

  constructor(message: string, options: DatabaseErrorOptions = {}) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = options.code;
    this.status = options.status;
  }

  static fromWire(
    error: { message: string; code?: string | null } | undefined,
  ): DatabaseError {
    return new DatabaseError(error?.message ?? "unknown database error", {
      code: error?.code ?? undefined,
    });
  }

  /** Classify a failure that happened before any SQL ran: an aborted, timed out, or unreachable request. */
  static fromTransport(cause: unknown): DatabaseError {
    if (cause instanceof DatabaseError) return cause;
    const { name, message } = (cause ?? {}) as {
      name?: string;
      message?: string;
    };
    if (name === "TimeoutError") {
      return new DatabaseError("database request timed out", {
        code: "TIMEOUT",
        cause,
      });
    }
    if (name === "AbortError") {
      return new DatabaseError("database request was aborted", {
        code: "ABORTED",
        cause,
      });
    }
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
