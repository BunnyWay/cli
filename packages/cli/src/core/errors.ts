export { UserError, ApiError } from "@bunny.net/api";
import { UserError } from "@bunny.net/api";

/**
 * Configuration-related error. Extends {@link UserError} with a hint
 * pointing the user to `bunny config show`.
 */
export class ConfigError extends UserError {
  constructor(message: string) {
    super(message, "Run `bunny config show` to check your configuration.");
    this.name = "ConfigError";
  }
}
