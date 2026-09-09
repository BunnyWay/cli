import { registriesGet, registriesUpdate } from "@bunny.net/tools/registries";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts } from "@/core/ui.ts";

const REGISTRY_TYPES = ["dockerHub", "gitHub"] as const;

async function promptText(
  message: string,
  type: "text" | "password" = "text",
  initial?: string,
): Promise<string | undefined> {
  const { value } = await prompts({ type, name: "value", message, initial });
  return value;
}

export const registryUpdateCommand = defineToolCommand({
  tool: registriesUpdate,
  command: "update <registry-id>",
  describe: "Update a container registry.",
  examples: [
    [
      "$0 registries update 123 --username notrab --password $TOKEN",
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
      .option("type", {
        type: "string",
        choices: REGISTRY_TYPES,
        describe: "Registry type (required for ghcr.io and docker.io)",
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

  progress: "Updating registry...",

  prepare: async (args, ctx) => {
    const registryId = args["registry-id"];
    const flagsProvided = Boolean(
      args.name ||
        args.type ||
        args.username !== undefined ||
        args.password !== undefined,
    );
    // Without flags this command is a pure interactive editor; unattended it would keep every value and report a no-op update as success.
    if (!flagsProvided && !isInteractive(args.output)) {
      throw new UserError(
        "No changes requested.",
        "Pass --name, or --username and --password, or run in a terminal to edit interactively.",
      );
    }

    let name = args.name;
    let username = args.username;
    let password = args.password;

    if (args.username !== undefined || args.password !== undefined) {
      username ??= await promptText("Username:");
      if (!username) {
        throw new UserError("Username is required when rotating credentials.");
      }
      password ??= await promptText("Password/Token:", "password");
      if (!password) {
        throw new UserError("Password is required when rotating credentials.");
      }
    }

    if (!flagsProvided) {
      const existing = await registriesGet.invoke(ctx, {
        registry: registryId,
      });

      name = await promptText("Display name:", "text", existing.name);
      if (!name) throw new UserError("Display name is required.");

      const { value: rotate } = await prompts({
        type: "confirm",
        name: "value",
        message: "Rotate credentials?",
        initial: false,
      });
      if (rotate) {
        username = await promptText(
          "Username:",
          "text",
          existing.username ?? undefined,
        );
        if (!username) throw new UserError("Username is required.");
        password = await promptText("Password/Token:", "password");
        if (!password) throw new UserError("Password is required.");
      }
    }

    return {
      input: {
        registry: registryId,
        name,
        username,
        password,
        type: args.type,
      },
    };
  },

  render: (registry) => {
    logger.success(`Registry "${registry.name}" updated.`);
  },
});
