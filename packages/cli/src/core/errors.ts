export { ApiError, UserError } from "@bunny.net/openapi-client";

// Single quotes keep names like `$prod` literal when the command is pasted into a shell.
function shellQuote(value: string): string {
  return /^[\w.@-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/** Name where the rejected key came from and how to replace it, never echoing the key itself. */
export function authenticationHint(args: {
  profile: string;
  apiKey?: string;
}): string {
  const login =
    args.profile === "default" || !args.profile
      ? "bunny login"
      : `bunny login --profile ${shellQuote(args.profile)}`;
  if (args.apiKey) {
    return `The key came from --api-key. Fix it, or drop the flag and run \`${login}\`.`;
  }
  if (process.env.BUNNYNET_API_KEY) {
    return `The key came from BUNNYNET_API_KEY. Fix it, or unset it and run \`${login}\`.`;
  }
  return `The key came from profile ${shellQuote(args.profile)}. Run \`${login}\` to authenticate again.`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
