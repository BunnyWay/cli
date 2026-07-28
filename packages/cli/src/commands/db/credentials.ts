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

/**
 * Resolve the database URL and auth token needed to connect over libSQL.
 *
 * Resolution order:
 * 1. Explicit `url` / `token` (the `--url` / `--token` flags)
 * 2. `BUNNY_DATABASE_URL` / `BUNNY_DATABASE_AUTH_TOKEN` from `.env`
 * 3. API lookup (fetches the URL and/or creates a short-lived token on the fly)
 *
 * Shared by `db shell`, `db studio`, and `db migrations apply`.
 */
export async function resolveCredentials(
  opts: ResolveCredentialsOptions,
): Promise<ResolvedCredentials> {
  let url = opts.url ?? readEnvValue(ENV_DATABASE_URL)?.value;
  let token = opts.token ?? readEnvValue(ENV_DATABASE_AUTH_TOKEN)?.value;

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

  const dbFetch = url
    ? Promise.resolve(null)
    : apiClient.GET("/v2/databases/{db_id}", {
        params: { path: { db_id: databaseId } },
      });

  if (willGenerateToken) spin.text = "Generating token...";

  const tokenFetch = willGenerateToken
    ? generateToken(apiClient, databaseId, {
        authorization: "full-access",
        expiresAt: tokenExpiryFromNow(),
      })
    : Promise.resolve(null);

  const [dbResult, tokenResult] = await Promise.all([dbFetch, tokenFetch]);

  spin.stop();

  if (!url && dbResult) url = dbResult.data?.db?.url;
  if (willGenerateToken && tokenResult) token = tokenResult.token;

  if (!url || !token) {
    throw new UserError("Could not resolve database URL or generate token.");
  }

  return { url, token, databaseId, tokenGenerated: willGenerateToken };
}
