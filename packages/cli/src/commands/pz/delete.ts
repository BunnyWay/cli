import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { removeManifest } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import {
  PULL_ZONE_MANIFEST,
} from "./constants.ts";
import { resolvePullZoneId } from "./resolve-pullzone.ts";

interface DeleteArgs {
  "name-or-id"?: string;
  force?: boolean;
}

export const pzDeleteCommand = defineCommand<DeleteArgs>({
  command: "delete [name-or-id]",
  describe: "Delete a pull zone.",
  examples: [
    ["$0 pz delete", "Delete selected pull zone"],
    ["$0 pz delete my-zone", "Delete by name"],
    ["$0 pz delete 12345", "Delete by ID"],
    ["$0 pz delete --force", "Skip confirmation"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name-or-id", {
        type: "string",
        describe: "Pull zone name or ID (uses selected one if omitted)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation",
      }),

  handler: async ({ "name-or-id": nameOrId, force, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { id: zoneId, name } = await resolvePullZoneId(client, nameOrId);

    const label = name ?? String(zoneId);
    const ok = await confirm(`Delete pull zone "${label}"?`, { force });
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

    // Remove manifest if it pointed at the deleted zone
    removeManifest(PULL_ZONE_MANIFEST);

    if (output === "json") {
      logger.log(JSON.stringify({ id: zoneId, deleted: true }));
      return;
    }

    logger.success(`Pull zone "${label}" deleted.`);
  },
});
