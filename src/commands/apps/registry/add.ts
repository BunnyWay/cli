import prompts from "prompts";
import { createMcClient } from "../../../api/mc-client.ts";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";

const COMMAND = "add";
const DESCRIPTION = "Add a container registry.";

interface AddArgs {
  name?: string;
  server?: string;
  username?: string;
}

export const appsRegistryAddCommand = defineCommand<AddArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .option("name", {
        type: "string",
        describe: "Display name",
      })
      .option("server", {
        type: "string",
        describe: "Registry server (e.g. ghcr.io)",
      })
      .option("username", {
        type: "string",
        describe: "Registry username",
      }),

  handler: async ({
    name: rawName,
    server,
    username: rawUsername,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    let displayName = rawName;
    if (!displayName) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Display name:",
      });
      displayName = value;
    }
    if (!displayName) throw new UserError("Display name is required.");

    let username = rawUsername;
    if (!username) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Username:",
      });
      username = value;
    }
    if (!username) throw new UserError("Username is required.");

    const { value: password } = await prompts({
      type: "password",
      name: "value",
      message: "Password/Token:",
    });
    if (!password) throw new UserError("Password is required.");

    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(config.apiKey, undefined, verbose);

    const spin = spinner("Adding registry...");
    spin.start();

    const { data: result } = await client.POST("/registries", {
      body: {
        displayName,
        passwordCredentials: { userName: username, password },
      },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result?.status === "Saved") {
      logger.success(`Registry "${displayName}" added (ID: ${result.id}).`);
    } else {
      logger.error(`Failed to add registry: ${result?.error ?? "unknown error"}`);
    }
  },
});
