import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { prompts } from "@/core/ui.ts";
import { registriesCreate } from "@/tools/apps/index.ts";

const REGISTRY_TYPES = ["dockerHub", "gitHub", "oci"] as const;

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
    [
      "$0 registries add --name scaleway --server rg.fr-par.scw.cloud --username nologin --password $TOKEN",
      "Add any other OCI registry",
    ],
    ["$0 registries add", "Prompt for each value"],
  ],

  builder: (yargs) =>
    yargs
      .option("name", { type: "string", describe: "Display name" })
      .option("server", {
        type: "string",
        describe:
          "Registry server (e.g. ghcr.io, registry.example.com:5000); used to derive --type",
      })
      .option("type", {
        type: "string",
        choices: REGISTRY_TYPES,
        describe:
          "Registry type; derived from --server (any host other than ghcr.io and docker.io is oci)",
      })
      .option("username", { type: "string", describe: "Registry username" })
      .option("password", {
        type: "string",
        describe: "Registry password or token",
      }),

  progress: "Adding registry...",

  prepare: async (args) => {
    const server =
      args.type && args.type !== "oci"
        ? args.server
        : await promptFor(
            args.server,
            "Registry server (e.g. ghcr.io, docker.io, registry.example.com):",
            "Server",
          );
    const name = await promptFor(args.name, "Display name:", "Display name");
    const username = await promptFor(args.username, "Username:", "Username");
    const password = await promptFor(
      args.password,
      "Password/Token:",
      "Password",
      "password",
    );
    return {
      input: { name, username, password, type: args.type, server },
    };
  },

  render: (registry) => {
    logger.success(`Registry "${registry.name}" added (ID: ${registry.id}).`);
  },
});
