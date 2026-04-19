import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { resolveAppId } from "../config.ts";

const COMMAND = "remove <endpoint-id>";
const DESCRIPTION = "Remove an endpoint.";

interface RemoveArgs {
  "endpoint-id": string;
  id?: string;
  force?: boolean;
}

export const appsEndpointsRemoveCommand = defineCommand<RemoveArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional("endpoint-id", {
        type: "string",
        describe: "Endpoint ID",
        demandOption: true,
      })
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.jsonc)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Skip confirmation prompt",
      }),

  handler: async ({
    "endpoint-id": endpointId,
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
      const confirmed = await confirm("Remove this endpoint?");
      if (!confirmed) {
        logger.log("Remove cancelled.");
        return;
      }
    }

    const spin = spinner("Removing endpoint...");
    spin.start();

    await client.DELETE("/apps/{appId}/endpoints/{endpointId}", {
      params: { path: { appId, endpointId } },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ endpointId, removed: true }));
      return;
    }

    logger.success("Endpoint removed.");
  },
});
