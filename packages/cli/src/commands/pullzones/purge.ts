import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { resolvePullZoneId } from "./resolve-pullzone.ts";

interface PurgeArgs {
  "name-or-id"?: string;
}

export const pullzonesPurgeCommand = defineCommand<PurgeArgs>({
  command: "purge [name-or-id]",
  describe: "Purge cached files for a pull zone.",
  examples: [
    ["$0 pullzones purge", "Purge cache for selected pull zone"],
    ["$0 pullzones purge my-zone", "Purge cache by name"],
    ["$0 pullzones purge 12345", "Purge cache by ID"],
  ],

  builder: (yargs) =>
    yargs.positional("name-or-id", {
      type: "string",
      describe: "Pull zone name or ID (uses selected one if omitted)",
    }),

  handler: async ({ "name-or-id": nameOrId, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { id: zoneId } = await resolvePullZoneId(client, nameOrId);

    const spin = spinner("Purging cache...");
    spin.start();

    await client.POST("/pullzone/{id}/purgeCache", {
      params: { path: { id: zoneId } },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ id: zoneId, purged: true }));
      return;
    }

    logger.success(`Cache purged for pull zone ${zoneId}.`);
  },
});
