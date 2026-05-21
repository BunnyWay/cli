import { createMcClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";

const COMMAND = "update <registry-id>";
const DESCRIPTION = "Update a container registry.";

interface UpdateArgs {
  "registry-id": number;
  name?: string;
  username?: string;
  password?: string;
}

export const registryUpdateCommand = defineCommand<UpdateArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    [
      "$0 registries update 123 --username notrab --password $(gh auth token)",
      "Rotate the credentials on registry 123",
    ],
    ["$0 registries update 123 --name 'ghcr.io (notrab)'", "Rename only"],
  ],

  builder: (yargs) =>
    yargs
      .positional("registry-id", {
        type: "number",
        describe: "Registry ID",
        demandOption: true,
      })
      .option("name", {
        type: "string",
        describe: "New display name (omit to keep current)",
      })
      .option("username", {
        type: "string",
        describe:
          "New registry username. Requires --password (or you'll be prompted).",
      })
      .option("password", {
        type: "string",
        describe:
          "New registry password/token. Requires --username (or you'll be prompted).",
      }),

  handler: async ({
    "registry-id": registryId,
    name: nameFlag,
    username: usernameFlag,
    password: passwordFlag,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createMcClient(clientOptions(config, verbose));

    const fetchSpin = spinner("Fetching registry...");
    fetchSpin.start();
    const { data: existing } = await client.GET("/registries/{registryId}", {
      params: { path: { registryId } },
    });
    fetchSpin.stop();

    if (!existing) {
      throw new UserError(`Registry ${registryId} not found.`);
    }

    const nonInteractive = Boolean(
      nameFlag || usernameFlag !== undefined || passwordFlag !== undefined,
    );

    // Resolve display name: flag → keep existing → prompt.
    let displayName = nameFlag ?? existing.displayName ?? "";
    if (!nonInteractive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Display name:",
        initial: displayName,
      });
      if (value !== undefined) displayName = value;
    }
    if (!displayName) {
      throw new UserError("Display name is required.");
    }

    // Resolve credentials. Either both flags (rotate creds) or neither
    // (keep existing). In interactive mode, ask explicitly.
    let userName: string | undefined;
    let password: string | undefined;

    if (usernameFlag !== undefined || passwordFlag !== undefined) {
      userName = usernameFlag;
      if (userName === undefined) {
        const { value } = await prompts({
          type: "text",
          name: "value",
          message: "Username:",
        });
        userName = value;
      }
      if (!userName) {
        throw new UserError("Username is required when rotating credentials.");
      }

      password = passwordFlag;
      if (password === undefined) {
        const { value } = await prompts({
          type: "password",
          name: "value",
          message: "Password/Token:",
        });
        password = value;
      }
      if (!password) {
        throw new UserError("Password is required when rotating credentials.");
      }
    } else if (!nonInteractive) {
      const { value: rotate } = await prompts({
        type: "confirm",
        name: "value",
        message: "Rotate credentials?",
        initial: false,
      });
      if (rotate) {
        const { value: u } = await prompts({
          type: "text",
          name: "value",
          message: "Username:",
          initial: existing.userName ?? undefined,
        });
        userName = u;
        if (!userName) throw new UserError("Username is required.");

        const { value: p } = await prompts({
          type: "password",
          name: "value",
          message: "Password/Token:",
        });
        password = p;
        if (!password) throw new UserError("Password is required.");
      }
    }

    const updateSpin = spinner("Updating registry...");
    updateSpin.start();

    const { data: result } = await client.PUT("/registries/{registryId}", {
      params: { path: { registryId } },
      body: {
        displayName,
        ...(userName && password
          ? { passwordCredentials: { userName, password } }
          : {}),
      },
    });

    updateSpin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result?.status === "saved") {
      logger.success(`Registry "${displayName}" updated.`);
    } else {
      throw new UserError(
        `Failed to update registry: ${result?.error ?? result?.status ?? "unknown error"}`,
      );
    }
  },
});
