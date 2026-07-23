import type { DbClient } from "@bunny.net/actions";
import type { components } from "@bunny.net/openapi-client/generated/database.d.ts";
import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import { loadManifest } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import { readEnvValue } from "../../utils/env-file.ts";
import { fetchAllDatabases } from "./api.ts";
import {
  DATABASE_MANIFEST,
  type DatabaseManifest,
  ENV_DATABASE_URL,
} from "./constants.ts";

type Database = Pick<components["schemas"]["Database2"], "id" | "name" | "url">;

export interface ResolvedDb {
  id: Database["id"];
  /** Database name when known from the manifest, env lookup, or prompt selection. */
  name?: Database["name"];
  source: "argument" | "manifest" | "env" | "prompt";
}

/**
 * Walk up the directory tree looking for a `.env` file containing a database URL.
 * Returns the URL value or `undefined` if not found.
 */
export function findDbUrlFromEnv(): string | undefined {
  return readEnvValue(ENV_DATABASE_URL)?.value;
}

/**
 * Resolve a database ID from an explicit value, `.bunny/database.json`, `.env`,
 * or interactive prompt.
 *
 * Resolution order:
 * 1. Explicit `databaseId` argument — returned immediately
 * 2. `.bunny/database.json` manifest — written by `bunny db link`
 * 3. `BUNNY_DATABASE_URL` in `.env` — matched against API database list
 * 4. Interactive prompt — fetches all databases and presents a select menu
 *
 * Throws if no databases exist or the `.env` URL doesn't match any database.
 */
export async function resolveDbId(
  client: DbClient,
  databaseId: Database["id"] | undefined,
): Promise<ResolvedDb> {
  if (databaseId) return { id: databaseId, source: "argument" };

  const manifest = loadManifest<DatabaseManifest>(DATABASE_MANIFEST);
  if (manifest.id)
    return { id: manifest.id, name: manifest.name, source: "manifest" };

  const url = findDbUrlFromEnv();

  const spin = url ? undefined : spinner("Fetching databases...");
  spin?.start();

  const allDatabases = await fetchAllDatabases(client);

  spin?.stop();

  // If we have a .env URL, try to match it
  if (url) {
    const match = allDatabases.find((db) => db.url === url);
    if (!match) {
      throw new UserError(
        `No database found matching ${ENV_DATABASE_URL}: ${url}`,
      );
    }
    return { id: match.id, name: match.name, source: "env" };
  }

  // No .env URL — prompt user to select
  if (allDatabases.length === 0) {
    throw new UserError(
      "No databases found.",
      'Run "bunny db create" to create one.',
    );
  }

  const { selected } = await prompts({
    type: "select",
    name: "selected",
    message: "Select a database:",
    choices: allDatabases.map((db) => ({
      title: `${db.name} (${db.id})`,
      value: db,
    })),
  });

  if (!selected) {
    throw new UserError("No database selected.");
  }

  return { id: selected.id, name: selected.name, source: "prompt" };
}
