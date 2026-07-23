import { registriesCreate } from "@bunny.net/actions";
import prompts from "prompts";
import { defineActionCommand } from "../../core/define-action-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";

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

export const registryAddCommand = defineActionCommand({
  action: registriesCreate,
  command: "add",
  describe: "Add a container registry.",

  builder: (yargs) =>
    yargs
      .option("name", {
        type: "string",
        describe: "Display name",
      })
      .option("server", {
        type: "string",
        describe: "Registry server (e.g. ghcr.io); used to derive --type",
      })
      .option("type", {
        type: "string",
        choices: ["dockerHub", "gitHub"] as const,
        describe: "Registry type (required for ghcr.io and docker.io)",
      })
      .option("username", {
        type: "string",
        describe: "Registry username",
      })
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
      input: {
        name,
        username,
        password,
        type: args.type as "dockerHub" | "gitHub" | undefined,
        server: args.server,
      },
    };
  },

  render: (registry) => {
    logger.success(`Registry "${registry.name}" added (ID: ${registry.id}).`);
  },
});
