import { dbTokensCreate, fetchDatabase } from "@bunny.net/actions";
import { resolveConfig } from "../../config/index.ts";
import { actionContext } from "../../core/action-context.ts";
import { UserError } from "../../core/errors.ts";
import { withSpinner } from "../../core/ui.ts";
import { readEnvValue } from "../../utils/env-file.ts";
import { tokenExpiryFromNow } from "./api.ts";
import { ENV_DATABASE_AUTH_TOKEN, ENV_DATABASE_URL } from "./constants.ts";
import { resolveDbId } from "./resolve-db.ts";

export interface DbConnection {
  url: string;
  token: string;
  databaseId: string | undefined;
  /** True when this call opened a new short-lived session rather than reusing existing credentials. */
  sessionCreated: boolean;
}

export interface DbConnectionOptions {
  /** Explicit `--url`, skipping the API lookup. */
  url?: string;
  /** Explicit `--token`, skipping session creation. */
  token?: string;
  databaseId?: string;
  profile: string;
  apiKey?: string;
  verbose?: boolean;
}

/**
 * Resolve the database URL and auth token needed to connect.
 *
 * Resolution order:
 * 1. Explicit `--url` / `--token` flags
 * 2. `BUNNY_DATABASE_URL` / `BUNNY_DATABASE_AUTH_TOKEN` from `.env`
 * 3. The API, via `db.tokens.create` (which returns the URL alongside the token)
 *
 * Shared by `db shell` and `db studio`, which both need a connection but
 * present it very differently.
 */
export async function resolveDbConnection(
  opts: DbConnectionOptions,
): Promise<DbConnection> {
  let url = opts.url ?? readEnvValue(ENV_DATABASE_URL)?.value;
  const token = opts.token ?? readEnvValue(ENV_DATABASE_AUTH_TOKEN)?.value;

  if (url && token) {
    return {
      url,
      token,
      databaseId: opts.databaseId,
      sessionCreated: false,
    };
  }

  const config = resolveConfig(opts.profile, opts.apiKey, opts.verbose);
  const ctx = actionContext(config, { verbose: opts.verbose });
  const { id: databaseId } = await resolveDbId(ctx.clients.db, opts.databaseId);

  // One spinner for the whole connect: the session is the user-facing step.
  const resolved = await withSpinner("Connecting...", async () => {
    if (token) {
      // Only the URL is missing, so read it back without opening a session.
      return {
        url: (await fetchDatabase(ctx.clients.db, databaseId)).url,
        token,
      };
    }
    const session = await dbTokensCreate.invoke(ctx, {
      database: databaseId,
      expiresAt: tokenExpiryFromNow(),
    });
    return { url: url ?? session.databaseUrl, token: session.token };
  });

  url = resolved.url;
  if (!url || !resolved.token) {
    throw new UserError("Could not resolve the database URL or connect.");
  }

  return {
    url,
    token: resolved.token,
    databaseId,
    sessionCreated: !token,
  };
}
