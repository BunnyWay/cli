import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { confirm, spinner } from "../../core/ui.ts";

const COMMAND = "remove <registry-id>";
const DESCRIPTION = "Remove a container registry.";

interface RemoveArgs {
  "registry-id": number;
  force?: boolean;
}

export const registryRemoveCommand = defineCommand<RemoveArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional("registry-id", {
        type: "number",
        describe: "Registry ID",
        demandOption: true,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Skip confirmation prompt",
      }),

  handler: async ({
    "registry-id": registryId,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    if (!force) {
      const confirmed = await confirm("Remove this registry?");
      if (!confirmed) {
        logger.log("Remove cancelled.");
        return;
      }
    }

    const spin = spinner("Removing registry...");
    spin.start();

    const { data: result } = await client.DELETE("/registries/{registryId}", {
      params: { path: { registryId } },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result?.status === "InUse") {
      throw new UserError(
        "Registry is in use by one or more apps.",
        `Apps using this registry: ${result.applications?.join(", ") ?? "unknown"}`,
      );
    }

    logger.success("Registry removed.");
  },
});
