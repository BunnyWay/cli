export { ApiError, UserError } from "@bunny.net/openapi-client";

import { UserError } from "@bunny.net/openapi-client";

/**
 * Configuration-related error. Extends {@link UserError} with a hint
 * pointing the user to `bunny config show`.
 */
export class ConfigError extends UserError {
  constructor(
    message: string,
    hint = "Run `bunny config show` to check your configuration.",
  ) {
    super(message, hint);
    this.name = "ConfigError";
  }
}

/** Explain credential precedence without including any credential values. */
export function authenticationHint(args: {
  profile: string;
  apiKey?: string;
}): string {
  const login =
    args.profile === "default"
      ? "bunny login"
      : `bunny login --profile ${JSON.stringify(args.profile)}`;
  if (args.apiKey) {
    const clearEnv = process.env.BUNNYNET_API_KEY
      ? ", unset BUNNYNET_API_KEY,"
      : "";
    return `API key source: --api-key. Replace its value, or omit the flag${clearEnv} and run \`${login}\`.`;
  }
  if (process.env.BUNNYNET_API_KEY) {
    return `API key source: BUNNYNET_API_KEY. Update it, or unset it and run \`${login}\`.`;
  }
  return `API key source: profile ${JSON.stringify(args.profile)}. Run \`${login}\` to authenticate again.`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
