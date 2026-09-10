import { registriesCreate } from "@bunny.net/tools/apps";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { prompts } from "@/core/ui.ts";

const REGISTRY_TYPES = ["dockerHub", "gitHub"] as const;

// Flag first, prompt second, error last: the prompt wrapper already refuses when stdin is not a terminal.
async function promptFor(
  flag: string | undefined,
  message: string,
  label: string,
  type: "text" | "password" = "text",
): Promise<string> {
  let value = flag;
  if (!value) {
    ({ value } = await prompts({ type, name: "value", message }));
  }
  if (!value) throw new UserError(`${label} is required.`);
  return value;
}

export const registryAddCommand = defineToolCommand({
  tool: registriesCreate,
  command: "add",
  describe: "Add a container registry.",
  examples: [
    [
      "$0 registries add --name 'ghcr.io (notrab)' --server ghcr.io --username notrab --password $TOKEN",
      "Add a GitHub container registry; the type is derived from the server",
    ],
    ["$0 registries add", "Prompt for each value"],
  ],

  builder: (yargs) =>
    yargs
      .option("name", { type: "string", describe: "Display name" })
      .option("server", {
        type: "string",
        describe: "Registry server (e.g. ghcr.io); used to derive --type",
      })
      .option("type", {
        type: "string",
        choices: REGISTRY_TYPES,
        describe: "Registry type (required for ghcr.io and docker.io)",
      })
      .option("username", { type: "string", describe: "Registry username" })
      .option("password", {
        type: "string",
        describe: "Registry password or token",
      }),

  progress: "Adding registry...",

  prepare: async (args) => {
    const name = await promptFor(args.name, "Display name:", "Display name");
    const username = await promptFor(args.username, "Username:", "Username");
    const password = await promptFor(
      args.password,
      "Password/Token:",
      "Password",
      "password",
    );
    return {
      input: { name, username, password, type: args.type, server: args.server },
    };
  },

  render: (registry) => {
    logger.success(`Registry "${registry.name}" added (ID: ${registry.id}).`);
  },
});
