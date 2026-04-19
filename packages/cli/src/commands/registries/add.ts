import { createMcClient } from "@bunny.net/api";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";

const COMMAND = "add";
const DESCRIPTION = "Add a container registry.";

interface AddArgs {
  name?: string;
  server?: string;
  username?: string;
  password?: string;
}

export const registryAddCommand = defineCommand<AddArgs>({
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
      })
      .option("password", {
        type: "string",
        describe: "Registry password or token",
      }),

  handler: async ({
    name: rawName,
    server: _server,
    username: rawUsername,
    password: rawPassword,
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

    let password = rawPassword;
    if (!password) {
      const { value } = await prompts({
        type: "password",
        name: "value",
        message: "Password/Token:",
      });
      password = value;
    }
    if (!password) throw new UserError("Password is required.");

    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

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
      logger.error(
        `Failed to add registry: ${result?.error ?? "unknown error"}`,
      );
    }
  },
});
