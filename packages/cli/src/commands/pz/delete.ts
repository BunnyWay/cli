import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, removeManifest } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { PULL_ZONE_MANIFEST, type PullZoneManifest } from "./constants.ts";

interface DeleteArgs {
  id?: number;
  force?: boolean;
}

export const pzDeleteCommand = defineCommand<DeleteArgs>({
  command: "delete [id]",
  describe: "Delete a pull zone.",
  examples: [
    ["$0 pz delete", "Delete selected pull zone"],
    ["$0 pz delete 12345", "Delete pull zone 12345"],
    ["$0 pz delete --force", "Skip confirmation"],
  ],

  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "number",
        describe: "Pull zone ID (uses selected one if omitted)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation",
      }),

  handler: async ({ id, force, profile, output, verbose, apiKey }) => {
    const zoneId = id ?? loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST).id;
    if (!zoneId) {
      throw new UserError(
        "No pull zone specified.",
        'Pass a pull zone ID or run "bunny pz link" first.',
      );
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { data: zone } = await client.GET("/pullzone/{id}", {
      params: { path: { id: zoneId } },
    });

    const label = zone?.Name ? `${zone.Name} (${zoneId})` : String(zoneId);

    const ok = await confirm(`Delete pull zone ${label}?`, { force });
    if (!ok) {
      logger.log("Delete cancelled.");
      return;
    }

    const spin = spinner("Deleting pull zone...");
    spin.start();

    const { error } = await client.DELETE("/pullzone/{id}", {
      params: { path: { id: zoneId } },
    });

    spin.stop();

    if (error) {
      throw new UserError(`Failed to delete pull zone: ${error}`);
    }

    // Remove manifest only if it pointed at the deleted zone
    const manifest = loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST);
    if (manifest.id === zoneId) {
      removeManifest(PULL_ZONE_MANIFEST);
    }

    if (output === "json") {
      logger.log(JSON.stringify({ id: zoneId, deleted: true }));
      return;
    }

    logger.success(`Pull zone ${label} deleted.`);
  },
});
