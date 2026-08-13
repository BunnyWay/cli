import { ENV_DATABASE_AUTH_TOKEN } from "./env.ts";

export class DatabaseError extends Error {
  override readonly name = "DatabaseError";

  /** SQLite/hrana error code (e.g. `SQLITE_CONSTRAINT_UNIQUE`). */
  readonly code?: string;

  /** HTTP status when the failure came from the transport rather than SQL. */
  readonly status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }

  static fromWire(
    error: { message: string; code?: string | null } | undefined,
  ): DatabaseError {
    return new DatabaseError(
      error?.message ?? "unknown database error",
      error?.code ?? undefined,
    );
  }

  static fromHttp(status: number, body: string): DatabaseError {
    let message = `database request failed with HTTP ${status}`;
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      if (parsed.error || parsed.message)
        message = String(parsed.error ?? parsed.message);
    } catch {
      if (body.trim()) message = body.trim().slice(0, 300);
    }
    if (status === 401 || status === 403) {
      return new DatabaseError(
        `${message} (check the auth token, or set ${ENV_DATABASE_AUTH_TOKEN})`,
        "UNAUTHORIZED",
        status,
      );
    }
    return new DatabaseError(message, undefined, status);
  }
}
