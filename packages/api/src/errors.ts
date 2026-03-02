/**
 * Expected error caused by user input or missing configuration.
 * Displayed as a clean message with an optional hint. Exit code 1.
 *
 * Throw this from command handlers or `preRun` hooks for any failure
 * the user can fix (bad flags, missing config, cancelled actions).
 */
export class UserError extends Error {
  isUserError = true;
  constructor(message: string, public hint?: string) {
    super(message);
    this.name = "UserError";
  }
}

/**
 * Error from a Bunny API HTTP response. Thrown automatically by
 * {@link authMiddleware} when a response has a non-OK status.
 *
 * Normalizes two different API error formats:
 * - **Core / Compute** — `ApiErrorData` with `ErrorKey`, `Field`, `Message`
 * - **Magic Containers** — RFC 7807 `ErrorDetails` with `title`, `detail`, `errors[]`
 *
 * Command handlers don't need to check response status codes —
 * non-OK responses are intercepted by middleware before they reach handler code.
 *
 * @param status - HTTP status code from the API response
 * @param field - The field that caused the error (from `ApiErrorData.Field`)
 * @param validationErrors - Field-level validation errors (from RFC 7807 `errors[]`)
 */
export class ApiError extends UserError {
  constructor(
    message: string,
    public status: number,
    public field?: string,
    public validationErrors?: Array<{ field?: string; message?: string }>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
