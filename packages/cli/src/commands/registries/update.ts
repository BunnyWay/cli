import { fetchRegistry, registriesUpdate } from "@bunny.net/actions";
import prompts from "prompts";
import { defineActionCommand } from "../../core/define-action-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";

export const registryUpdateCommand = defineActionCommand({
  action: registriesUpdate,
  command: "update <registry-id>",
  describe: "Update a container registry.",
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
      .option("type", {
        type: "string",
        choices: ["dockerHub", "gitHub"] as const,
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
    const nameFlag = args.name;
    const usernameFlag = args.username;
    const passwordFlag = args.password;

    const nonInteractive = Boolean(
      nameFlag || usernameFlag !== undefined || passwordFlag !== undefined,
    );

    // Only fetch the current record when a prompt needs it for initial values.
    const existing = nonInteractive
      ? undefined
      : await fetchRegistry(ctx.clients.mc, registryId);

    // Resolve display name: flag → keep existing → prompt.
    let displayName = nameFlag;
    if (!nonInteractive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Display name:",
        initial: existing?.displayName ?? "",
      });
      if (value !== undefined) displayName = value;
      if (!displayName) throw new UserError("Display name is required.");
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
          initial: existing?.userName ?? undefined,
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

    return {
      input: {
        registry: registryId,
        name: displayName,
        username: userName,
        password,
        type: args.type as "dockerHub" | "gitHub" | undefined,
      },
    };
  },

  render: (registry) => {
    logger.success(`Registry "${registry.name}" updated.`);
  },
});
