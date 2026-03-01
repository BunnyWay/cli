import { createMcClient } from "../../../api/mc-client.ts";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId, resolveContainerId } from "../toml.ts";

const COMMAND = "set <key> <value>";
const DESCRIPTION = "Set an environment variable.";

interface SetArgs {
  key: string;
  value: string;
  id?: string;
  container?: string;
}

export const appsEnvSetCommand = defineCommand<SetArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional("key", {
        type: "string",
        describe: "Variable name",
        demandOption: true,
      })
      .positional("value", {
        type: "string",
        describe: "Variable value",
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
    value,
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

    // Read-modify-write: fetch current vars, update, PUT all
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

    // Build flat key-value object for the API
    const envMap: Record<string, string> = {};
    for (const v of existing) {
      envMap[v.name] = v.value ?? "";
    }
    envMap[key] = value;

    spin.text = "Setting variable...";

    await client.PUT("/apps/{appId}/containers/{containerId}/env", {
      params: { path: { appId, containerId } },
      body: envMap,
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ key, value, container: containerName ?? "primary" }));
      return;
    }

    logger.success(`Variable "${key}" set.`);
  },
});
