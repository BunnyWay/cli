import { createDbClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { UserError } from "../../core/errors.ts";
import { spinner } from "../../core/ui.ts";
import { readEnvValue } from "../../utils/env-file.ts";
import { generateToken, tokenExpiryFromNow } from "./api.ts";
import { ENV_DATABASE_AUTH_TOKEN, ENV_DATABASE_URL } from "./constants.ts";
import { resolveDbId } from "./resolve-db.ts";

export interface ResolvedCredentials {
  url: string;
  token: string;
  databaseId: string | undefined;
  /** True when a short-lived token was created for this run rather than read from flags or `.env`. */
  tokenGenerated: boolean;
}

export interface ResolveCredentialsOptions {
  url?: string;
  token?: string;
  databaseId?: string;
  profile: string;
  apiKey?: string;
  verbose?: boolean;
}

/** Same host, ignoring scheme, port, and path, since `libsql://` and `https://` address the same endpoint. */
export function sameHost(a: string, b: string): boolean {
  try {
    return (
      new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the database URL and auth token needed to connect over libSQL.
 *
 * Resolution order:
 * 1. Explicit `url` / `token` (the `--url` / `--token` flags)
 * 2. `BUNNY_DATABASE_URL` / `BUNNY_DATABASE_AUTH_TOKEN` from `.env`
 * 3. API lookup (fetches the URL and/or creates a short-lived token on the fly)
 *
 * An explicit database ID skips step 2 entirely: `.env` may describe a different
 * database, and silently connecting there would target the wrong database.
 *
 * A generated token is only ever sent to a URL that belongs to the database it
 * was created for, so overriding `--url` without `--token` is rejected rather
 * than handing a full-access token to an unverified host.
 *
 * Shared by `db shell`, `db studio`, and `db migrations apply`.
 */
export async function resolveCredentials(
  opts: ResolveCredentialsOptions,
): Promise<ResolvedCredentials> {
  const useEnv = !opts.databaseId;
  let url =
    opts.url ?? (useEnv ? readEnvValue(ENV_DATABASE_URL)?.value : undefined);
  let token =
    opts.token ??
    (useEnv ? readEnvValue(ENV_DATABASE_AUTH_TOKEN)?.value : undefined);

  if (url && token) {
    return {
      url,
      token,
      databaseId: opts.databaseId,
      tokenGenerated: false,
    };
  }

  const config = resolveConfig(opts.profile, opts.apiKey, opts.verbose);
  const apiClient = createDbClient(clientOptions(config, opts.verbose));

  const { id: databaseId } = await resolveDbId(apiClient, opts.databaseId);

  const spin = spinner("Connecting...");
  spin.start();

  const willGenerateToken = !token;

  const fetchDatabase = () =>
    apiClient.GET("/v2/databases/{db_id}", {
      params: { path: { db_id: databaseId } },
    });

  const mintToken = () => {
    spin.text = "Generating token...";
    return generateToken(apiClient, databaseId, {
      authorization: "full-access",
      expiresAt: tokenExpiryFromNow(),
    });
  };

  try {
    if (url && willGenerateToken) {
      // Verify the override before creating a token, so a token is never created for a host we'd refuse.
      const { data } = await fetchDatabase();
      const canonical = data?.db?.url;

      if (!canonical) {
        throw new UserError(`Could not fetch database ${databaseId}.`);
      }

      if (!sameHost(url, canonical)) {
        throw new UserError(
          `--url does not point at ${databaseId}.`,
          `Pass --token for that URL, or drop --url to connect to ${canonical}.`,
        );
      }

      token = (await mintToken())?.token;
    } else {
      const [dbResult, tokenResult] = await Promise.all([
        url ? Promise.resolve(null) : fetchDatabase(),
        willGenerateToken ? mintToken() : Promise.resolve(null),
      ]);

      if (!url) url = dbResult?.data?.db?.url;
      if (willGenerateToken) token = tokenResult?.token;
    }
  } finally {
    spin.stop();
  }

  if (!url || !token) {
    throw new UserError("Could not resolve database URL or generate token.");
  }

  return { url, token, databaseId, tokenGenerated: willGenerateToken };
}
