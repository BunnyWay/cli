import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { resolveAppId, resolveContainerId } from "../config.ts";

const COMMAND = "pull";
const DESCRIPTION = "Pull environment variables to a local .env file.";

interface PullArgs {
  id?: string;
  container?: string;
  force?: boolean;
}

export const appsEnvPullCommand = defineCommand<PullArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.jsonc)",
      })
      .option("container", {
        type: "string",
        describe: "Container name (defaults to primary)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Overwrite .env without prompting",
      }),

  handler: async ({
    id: rawId,
    container: containerName,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching environment variables...");
    spin.start();

    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    spin.stop();

    if (!app) {
      throw new UserError(`App ${appId} not found.`);
    }

    const containerId = resolveContainerId(app, containerName);
    const container = app.containerTemplates.find((c) => c.id === containerId);
    const vars = container?.environmentVariables ?? [];

    if (vars.length === 0) {
      logger.info("No environment variables to pull.");
      return;
    }

    const envContent = `${vars.map((v) => `${v.name}=${v.value ?? ""}`).join("\n")}\n`;

    const envPath = join(process.cwd(), ".env");

    if (existsSync(envPath) && !force) {
      const confirmed = await confirm(".env already exists. Overwrite?");
      if (!confirmed) {
        logger.log("Pull cancelled.");
        return;
      }
    }

    writeFileSync(envPath, envContent, { mode: 0o600 });

    if (output === "json") {
      logger.log(JSON.stringify(vars, null, 2));
      return;
    }

    logger.success(`Pulled ${vars.length} variables to .env.`);
  },
});
