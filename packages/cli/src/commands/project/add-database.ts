import { createDbClient } from "@bunny.net/openapi-client";
import { databaseToBinding } from "@bunny.net/project-config";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadProjectConfig, upsertBinding } from "../../core/project-config.ts";
import { spinner } from "../../core/ui.ts";
import { fetchAllDatabases, fetchDatabase } from "../db/api.ts";
import { ARG_DATABASE_ID } from "../db/constants.ts";
import {
  ARG_BINDING,
  ARG_BINDING_DESCRIPTION,
  assertBindingName,
  ensureBindingReplaceable,
} from "./shared.ts";

const COMMAND = `database <${ARG_BINDING}> [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Map an existing database into the project config.";

interface AddDatabaseArgs {
  [ARG_BINDING]: string;
  [ARG_DATABASE_ID]?: string;
}

/** Fetch a database (by ID or interactive selection) and record it under the given binding. */
export const projectAddDatabaseCommand = defineCommand<AddDatabaseArgs>({
  command: COMMAND,
  aliases: ["db"],
  describe: DESCRIPTION,
  examples: [
    ["$0 project add database db", "Interactive selection"],
    [
      "$0 project add database db db_01KCHBG8C5KSFGG0VRNFQ7EK7X",
      "Map a known database ID",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_BINDING, {
        type: "string",
        describe: ARG_BINDING_DESCRIPTION,
        demandOption: true,
      })
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe: "Database ID (prompts for selection when omitted)",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const binding = args[ARG_BINDING];
    const isInteractive = output !== "json" && process.stdout.isTTY;

    assertBindingName(binding);
    const projectConfig = loadProjectConfig();

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createDbClient(clientOptions(config, verbose));

    let db: { id: string; name: string };
    const databaseIdArg = args[ARG_DATABASE_ID];
    if (databaseIdArg) {
      const spin = spinner("Fetching database...");
      spin.start();
      db = await fetchDatabase(client, databaseIdArg);
      spin.stop();
    } else {
      const spin = spinner("Fetching databases...");
      spin.start();
      const all = await fetchAllDatabases(client);
      spin.stop();

      if (all.length === 0) {
        throw new UserError(
          "No databases found.",
          'Run "bunny db create" to create one.',
        );
      }

      const { selected } = await prompts({
        type: "select",
        name: "selected",
        message: `Select a database to map as "${binding}":`,
        choices: all
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d) => ({ title: `${d.name} (${d.id})`, value: d })),
      });
      if (!selected) throw new UserError("Cancelled.");
      db = selected;
    }

    await ensureBindingReplaceable(
      projectConfig,
      "databases",
      binding,
      db.id,
      isInteractive,
    );

    const path = upsertBinding("databases", binding, databaseToBinding(db));

    if (output === "json") {
      logger.log(JSON.stringify({ binding, id: db.id, name: db.name, path }));
      return;
    }

    logger.success(`Mapped databases.${binding} → ${db.name} (${db.id}).`);
  },
});
