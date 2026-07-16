import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import { PULL_ZONE_MANIFEST, type PullZoneManifest } from "./constants.ts";

interface PurgeArgs {
  id?: number;
}

export const pzPurgeCommand = defineCommand<PurgeArgs>({
  command: "purge [id]",
  describe: "Purge cached files for a pull zone.",
  examples: [
    ["$0 pz purge", "Purge cache for selected pull zone"],
    ["$0 pz purge 12345", "Purge cache for pull zone 12345"],
  ],

  builder: (yargs) =>
    yargs.positional("id", {
      type: "number",
      describe: "Pull zone ID (uses selected one if omitted)",
    }),

  handler: async ({ id, profile, output, verbose, apiKey }) => {
    const zoneId = id ?? loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST).id;
    if (!zoneId) {
      throw new UserError(
        "No pull zone specified.",
        'Pass a pull zone ID or run "bunny pz link" first.',
      );
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const spin = spinner("Purging cache...");
    spin.start();

    const { error } = await client.POST("/pullzone/{id}/purgeCache", {
      params: { path: { id: zoneId } },
    });

    spin.stop();

    if (error) {
      throw new UserError(`Failed to purge cache: ${error}`);
    }

    if (output === "json") {
      logger.log(JSON.stringify({ id: zoneId, purged: true }));
      return;
    }

    logger.success(`Cache purged for pull zone ${zoneId}.`);
  },
});
