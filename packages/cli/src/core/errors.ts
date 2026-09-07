export { ApiError, UserError } from "@bunny.net/openapi-client";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
