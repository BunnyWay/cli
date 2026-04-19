import type { components } from "@bunny.net/api/generated/database.d.ts";
import prompts from "prompts";
import { defineCommand } from "../../core/define-command.ts";
import { resolveConfig } from "../../config/index.ts";
import { createDbClient } from "@bunny.net/api";
import { spinner } from "../../core/ui.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { UserError } from "../../core/errors.ts";
import { ARG_DATABASE_ID, DATABASE_MANIFEST, type DatabaseManifest } from "./constants.ts";
import { clientOptions } from "../../core/client-options.ts";

type Database = Pick<components["schemas"]["Database2"], "id" | "name">;

const COMMAND = `link [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Link the current directory to a database.";

interface LinkArgs {
  [ARG_DATABASE_ID]?: string;
}

/**
 * Link the current directory to a database.
 *
 * Saves the database ID and name into a local `.bunny/database.json`
 * manifest so subsequent commands (e.g. `db shell`, `db studio`) can
 * resolve the database automatically without `BUNNY_DATABASE_URL` in
 * `.env`.
 *
 * When a `database-id` is provided the database is fetched and linked
 * immediately; otherwise an interactive prompt lists all available
 * databases.
 *
 * @example
 * ```bash
 * # Interactive selection
 * bunny db link
 *
 * # Direct link by ID
 * bunny db link db_01KCHBG8C5KSFGG0VRNFQ7EK7X
 * ```
 */
export const dbLinkCommand = defineCommand<LinkArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db link", "Interactive selection"],
    ["$0 db link db_01KCHBG8C5KSFGG0VRNFQ7EK7X", "Direct link by ID"],
  ],

  handler: async ({ [ARG_DATABASE_ID]: databaseIdArg, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createDbClient(clientOptions(config, verbose));

    if (databaseIdArg) {
      const spin = spinner("Fetching database...");
      spin.start();

      const { data } = await client.GET("/v2/databases/{db_id}", {
        params: { path: { db_id: databaseIdArg } },
      });

      spin.stop();

      const db = data?.db;
      if (!db) {
        throw new UserError(`Database ${databaseIdArg} not found.`);
      }

      saveManifest<DatabaseManifest>(DATABASE_MANIFEST, {
        id: db.id,
        name: db.name,
      });

      if (output === "json") {
        logger.log(JSON.stringify({ id: db.id, name: db.name }));
        return;
      }

      logger.success(`Linked to ${db.name} (${db.id}).`);
      return;
    }

    const spin = spinner("Fetching databases...");
    spin.start();

    const allDatabases: Database[] = [];
    let page = 1;

    while (true) {
      const { data } = await client.GET("/v2/databases", {
        params: { query: { page, per_page: 100 } },
      });

      allDatabases.push(...(data?.databases ?? []));

      if (!data?.page_info?.has_more_items) break;
      page++;
    }

    spin.stop();

    if (allDatabases.length === 0) {
      throw new UserError(
        "No databases found.",
        'Run "bunny db create" to create one.',
      );
    }

    const databases = allDatabases.sort((a, b) => a.name.localeCompare(b.name));

    const { selected } = await prompts({
      type: "select",
      name: "selected",
      message: "Select a database to link:",
      choices: databases.map((db) => ({
        title: `${db.name} (${db.id})`,
        value: db,
      })),
    });

    if (!selected) {
      logger.log("Link cancelled.");
      process.exit(1);
    }

    saveManifest<DatabaseManifest>(DATABASE_MANIFEST, {
      id: selected.id,
      name: selected.name,
    });

    if (output === "json") {
      logger.log(JSON.stringify({ id: selected.id, name: selected.name }));
      return;
    }

    logger.success(`Linked to ${selected.name} (${selected.id}).`);
  },
});
