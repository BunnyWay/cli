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

export interface DatabaseTarget {
  databaseId: string | null;
  host: string;
  label: string;
}

export interface ResolveCredentialsOptions {
  url?: string;
  token?: string;
  databaseId?: string;
  profile: string;
  apiKey?: string;
  verbose?: boolean;
}

/** Schemes that encrypt in transit. `libsql:` resolves to `https:`/`wss:` unless it opts out with `?tls=0`. */
const ENCRYPTED_SCHEMES = new Set(["libsql:", "https:", "wss:"]);
const DEFAULT_TLS_PORT = "443";

/** A credential-free database identity suitable for prompts and structured output. */
export function databaseTarget(
  url: string,
  databaseId?: string,
): DatabaseTarget {
  let host = "unknown host";
  try {
    host = new URL(url).host || host;
  } catch {
    // Credential resolution or the client will provide the actionable URL error.
  }

  return {
    databaseId: databaseId ?? null,
    host,
    label: databaseId ? `${databaseId} (${host})` : host,
  };
}

/**
 * True when traffic to this URL is encrypted, so a token we create can be sent to it.
 *
 * The scheme alone isn't enough: `libsql://host:port?tls=0` downgrades to
 * plaintext `http:`/`ws:` inside the libSQL client.
 */
export function isEncrypted(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!ENCRYPTED_SCHEMES.has(parsed.protocol)) return false;
    return parsed.searchParams.get("tls") !== "0";
  } catch {
    return false;
  }
}

/**
 * Same encrypted service endpoint, allowing equivalent libSQL/HTTP/WebSocket
 * schemes but not a different authority port.
 */
export function sameEndpoint(a: string, b: string): boolean {
  try {
    const first = new URL(a);
    const second = new URL(b);
    const firstPort = first.port || DEFAULT_TLS_PORT;
    const secondPort = second.port || DEFAULT_TLS_PORT;

    return (
      first.hostname.toLowerCase() === second.hostname.toLowerCase() &&
      firstPort === secondPort
    );
  } catch {
    return false;
  }
}

function requireEncrypted(url: string): void {
  if (isEncrypted(url)) return;

  throw new UserError(
    "Database URL must use an encrypted connection.",
    "Use the libsql://, https://, or wss:// URL provided by Bunny Database.",
  );
}

/**
 * True when the token stored in `.env` may be sent to an explicit `--url`.
 *
 * The `.env` token belongs to the `.env` URL: that pairing is the user's own, so
 * it holds for the same endpoint and nothing else. An override addressing anywhere
 * else falls through to the API path, where a fresh token is created and checked
 * against the database's canonical URL instead of reusing the stored one.
 *
 * Checked against `.env` rather than the API so the offline case (both values in
 * `.env`, `--url` naming the same endpoint) still needs no network call.
 */
export function envTokenAllowedFor(
  explicitUrl: string | undefined,
  envUrl: string | undefined,
): boolean {
  if (!envUrl) return false;
  if (!isEncrypted(envUrl)) return false;
  if (!explicitUrl) return true;
  return sameEndpoint(explicitUrl, envUrl) && isEncrypted(explicitUrl);
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
 * The rule for tokens is that a credential the user didn't pass on this command
 * line is never sent to a target they did. So a generated token only goes to an
 * encrypted URL belonging to the database it was created for, and the `.env`
 * token only goes to an encrypted `--url` on the same endpoint as the `.env`
 * URL. Every URL must be encrypted, including URLs paired with an explicit token.
 *
 * Shared by `db shell`, `db studio`, and `db migrations apply`.
 */
export async function resolveCredentials(
  opts: ResolveCredentialsOptions,
): Promise<ResolvedCredentials> {
  const useEnv = !opts.databaseId;
  const envUrl = useEnv ? readEnvValue(ENV_DATABASE_URL)?.value : undefined;
  const envToken = useEnv
    ? readEnvValue(ENV_DATABASE_AUTH_TOKEN)?.value
    : undefined;

  let url = opts.url ?? envUrl;
  let token =
    opts.token ?? (envTokenAllowedFor(opts.url, envUrl) ? envToken : undefined);

  if (url) requireEncrypted(url);

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
      // Verify the override before creating a token, so a token is never created for an endpoint we'd refuse.
      const { data } = await fetchDatabase();
      const canonical = data?.db?.url;

      if (!canonical) {
        throw new UserError(`Could not fetch database ${databaseId}.`);
      }

      if (!sameEndpoint(url, canonical)) {
        throw new UserError(
          `--url does not point at ${databaseId}.`,
          `Use the URL provided by Bunny Database, or drop --url to connect to ${canonical}.`,
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

  requireEncrypted(url);

  return { url, token, databaseId, tokenGenerated: willGenerateToken };
}
