import { VERSION } from "../../core/version.ts";

/** Identify CLI database traffic as `bunny-cli/<version> (<command>)`. */
export function databaseUserAgent(command: string): string {
  return `bunny-cli/${VERSION} (${command})`;
}

/** Positional argument name for the database ID. */
export const ARG_DATABASE_ID = "database-id" as const;

/** Environment variable name for the database connection URL. */
export const ENV_DATABASE_URL = "BUNNY_DATABASE_URL";

/** Environment variable name for the database auth token. */
export const ENV_DATABASE_AUTH_TOKEN = "BUNNY_DATABASE_AUTH_TOKEN";

/** Filename for the linked-database manifest stored under `.bunny/`. */
export const DATABASE_MANIFEST = "database.json";

/** Page size used when paginating the database list endpoint. */
export const DB_PAGE_SIZE = 100;

/** Maximum length the backend accepts for a database name. */
export const DB_NAME_MAX_LENGTH = 16;

/** Default lifetime for tokens minted by `db shell` / `db studio`. */
export const TOKEN_TTL_MINUTES = 30;

/** Shape of `.bunny/database.json`. */
export interface DatabaseManifest {
  id: string;
  name?: string;
}
