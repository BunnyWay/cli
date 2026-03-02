import type { components } from "@bunny.net/api/generated/database.d.ts";
import type { createDbClient } from "@bunny.net/api";

type Database = Pick<components["schemas"]["Database2"], "id" | "name" | "url">;
import prompts from "prompts";
import { readEnvValue } from "../../utils/env-file.ts";
import { spinner } from "../../core/ui.ts";
import { UserError } from "../../core/errors.ts";
import { ENV_DATABASE_URL } from "./constants.ts";

/**
 * Walk up the directory tree looking for a `.env` file containing a database URL.
 * Returns the URL value or `undefined` if not found.
 */
export function findDbUrlFromEnv(): string | undefined {
  return readEnvValue(ENV_DATABASE_URL)?.value;
}

/**
 * Resolve a database ID from an explicit value, `.env`, or interactive prompt.
 *
 * Resolution order:
 * 1. Explicit `databaseId` argument — returned immediately
 * 2. `BUNNY_DATABASE_URL` in `.env` — matched against API database list
 * 3. Interactive prompt — fetches all databases and presents a select menu
 *
 * Throws if no databases exist or the `.env` URL doesn't match any database.
 */
export async function resolveDbId(
  client: ReturnType<typeof createDbClient>,
  databaseId: Database["id"] | undefined,
): Promise<{ id: Database["id"]; source: "argument" | "env" | "prompt" }> {
  if (databaseId) return { id: databaseId, source: "argument" };

  const url = findDbUrlFromEnv();

  // Paginate through all databases
  const allDatabases: Database[] = [];
  let page = 1;

  const spin = url ? undefined : spinner("Fetching databases...");
  spin?.start();

  while (true) {
    const { data } = await client.GET("/v2/databases", {
      params: { query: { page, per_page: 100 } },
    });

    allDatabases.push(...(data?.databases ?? []));

    if (!data?.page_info?.has_more_items) break;
    page++;
  }

  spin?.stop();

  // If we have a .env URL, try to match it
  if (url) {
    const match = allDatabases.find((db) => db.url === url);
    if (!match) {
      throw new UserError(
        `No database found matching ${ENV_DATABASE_URL}: ${url}`,
      );
    }
    return { id: match.id, source: "env" };
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
      value: db.id,
    })),
  });

  if (!selected) {
    process.exit(1);
  }

  return { id: selected, source: "prompt" };
}
