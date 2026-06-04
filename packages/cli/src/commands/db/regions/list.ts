import { createDbClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { fetchDatabaseWithRegions, regionNameMap } from "../api.ts";
import { ARG_DATABASE_ID } from "../constants.ts";
import { resolveDbId } from "../resolve-db.ts";

const COMMAND = `list [${ARG_DATABASE_ID}]`;
const ALIASES = ["ls"] as const;
const DESCRIPTION = "List configured regions for a database.";

interface ListArgs {
  [ARG_DATABASE_ID]?: string;
}

/**
 * List the configured primary and replica regions for a database.
 *
 * @example
 * ```bash
 * bunny db regions list
 * bunny db regions list db_01KCHBG8C5KSFGG0VRNFQ7EK7X
 * bunny db regions list --output json
 * ```
 */
export const dbRegionsListCommand = defineCommand<ListArgs>({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    ["$0 db regions list", "List regions for auto-detected database"],
    ["$0 db regions list --output json", "JSON output for scripting"],
  ],

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createDbClient(clientOptions(config, verbose));

    const { id: databaseId } = await resolveDbId(client, databaseIdArg);

    const spin = spinner("Fetching regions...");
    spin.start();

    const { db, config: regionConfig } = await fetchDatabaseWithRegions(
      client,
      databaseId,
    );

    spin.stop();

    const regionNames = regionNameMap(regionConfig);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            db_id: databaseId,
            primary_regions: db.primary_regions,
            replicas_regions: db.replicas_regions,
          },
          null,
          2,
        ),
      );
      return;
    }

    const rows: string[][] = [];
    for (const id of db.primary_regions) {
      rows.push(["Primary", regionNames.get(id) ?? id, id]);
    }
    for (const id of db.replicas_regions) {
      rows.push(["Replica", regionNames.get(id) ?? id, id]);
    }

    if (rows.length === 0) {
      logger.info("No regions configured.");
      return;
    }

    logger.log(formatTable(["Type", "Name", "ID"], rows, output));
  },
});
