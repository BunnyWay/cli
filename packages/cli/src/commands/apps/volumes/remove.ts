import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { resolveAppId } from "../toml.ts";
import { clientOptions } from "../../../core/client-options.ts";

const COMMAND = "remove <volume-id>";
const DESCRIPTION = "Remove a volume.";

interface RemoveArgs {
  "volume-id": string;
  id?: string;
  force?: boolean;
}

export const appsVolumesRemoveCommand = defineCommand<RemoveArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional("volume-id", {
        type: "string",
        describe: "Volume ID",
        demandOption: true,
      })
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.toml)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Skip confirmation prompt",
      }),

  handler: async ({
    "volume-id": volumeId,
    id: rawId,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    if (!force) {
      const confirmed = await confirm(
        "Remove this volume? All data will be lost.",
      );
      if (!confirmed) {
        logger.log("Remove cancelled.");
        return;
      }
    }

    const spin = spinner("Removing volume...");
    spin.start();

    await client.DELETE("/apps/{appId}/volumes/{volumeId}", {
      params: { path: { appId, volumeId } },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ volumeId, removed: true }));
      return;
    }

    logger.success("Volume removed.");
  },
});
