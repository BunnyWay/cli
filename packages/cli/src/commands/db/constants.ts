/** Positional argument name for the database ID. */
export const ARG_DATABASE_ID = "database-id" as const;

/** Environment variable name for the database connection URL. */
export const ENV_DATABASE_URL = "BUNNY_DATABASE_URL";

/** Environment variable name for the database auth token. */
export const ENV_DATABASE_AUTH_TOKEN = "BUNNY_DATABASE_AUTH_TOKEN";

/** Filename for the linked-database manifest stored under `.bunny/`. */
export const DATABASE_MANIFEST = "database.json";

/** Shape of `.bunny/database.json`. */
export interface DatabaseManifest {
  id: string;
  name?: string;
}
