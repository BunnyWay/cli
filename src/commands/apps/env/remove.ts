import { createMcClient } from "../../../api/mc-client.ts";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId, resolveContainerId } from "../toml.ts";

const COMMAND = "remove <key>";
const DESCRIPTION = "Remove an environment variable.";

interface RemoveArgs {
  key: string;
  id?: string;
  container?: string;
}

export const appsEnvRemoveCommand = defineCommand<RemoveArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional("key", {
        type: "string",
        describe: "Variable name to remove",
        demandOption: true,
      })
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.toml)",
      })
      .option("container", {
        type: "string",
        describe: "Container name (defaults to primary)",
      }),

  handler: async ({
    key,
    id: rawId,
    container: containerName,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(config.apiKey, undefined, verbose);

    const spin = spinner("Fetching current variables...");
    spin.start();

    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    if (!app) {
      spin.stop();
      throw new UserError(`App ${appId} not found.`);
    }

    const containerId = resolveContainerId(app, containerName);
    const container = app.containerTemplates.find((c) => c.id === containerId);
    const existing = container?.environmentVariables ?? [];

    const found = existing.find((v) => v.name === key);
    if (!found) {
      spin.stop();
      throw new UserError(`Variable "${key}" not found.`);
    }

    // Build flat key-value object without the removed key
    const envMap: Record<string, string> = {};
    for (const v of existing) {
      if (v.name !== key) {
        envMap[v.name] = v.value ?? "";
      }
    }

    spin.text = "Removing variable...";

    await client.PUT("/apps/{appId}/containers/{containerId}/env", {
      params: { path: { appId, containerId } },
      body: envMap,
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ key, removed: true }));
      return;
    }

    logger.success(`Variable "${key}" removed.`);
  },
});
