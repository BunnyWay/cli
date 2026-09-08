export { ApiError, UserError } from "@bunny.net/openapi-client";

import { shellQuoteIfNeeded } from "./shell.ts";

/** Explain a 401 by naming where the key came from (or that none was loaded), never echoing the key itself. */
export function unauthorizedError(args: {
  profile: string;
  apiKey?: string;
  hasProfile: boolean;
}): { message: string; hint: string } {
  const login =
    args.profile === "default" || !args.profile
      ? "bunny login"
      : `bunny login --profile ${shellQuoteIfNeeded(args.profile)}`;
  const message = "Unauthorized. Your API key was rejected.";
  if (args.apiKey) {
    return {
      message,
      hint: `The key came from --api-key. Fix it, or drop the flag and run \`${login}\`.`,
    };
  }
  if (process.env.BUNNYNET_API_KEY) {
    return {
      message,
      hint: `The key came from BUNNYNET_API_KEY. Fix it, or unset it and run \`${login}\`.`,
    };
  }
  if (args.hasProfile) {
    return {
      message,
      hint: `The key came from profile ${shellQuoteIfNeeded(args.profile)}. Run \`${login}\` to authenticate again.`,
    };
  }
  return { message: "Not logged in.", hint: `Run "${login}" to authenticate.` };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
