import { createComputeClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, prompts, spinner } from "../../../core/ui.ts";
import { fetchEnvEntries } from "../api.ts";
import {
  type ScriptSelectorArgs,
  scriptIdOptionBuilder,
  selectScript,
} from "../interactive.ts";

const COMMAND = "remove [name]";
const ALIASES = ["rm"] as const;
const DESCRIPTION =
  "Remove an environment variable or secret from an Edge Script.";

const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Variable or secret name to remove";
const ARG_FORCE = "force";
const ARG_FORCE_ALIAS = "f";
const ARG_FORCE_DESCRIPTION = "Skip confirmation prompt";

interface RemoveArgs extends ScriptSelectorArgs {
  [ARG_NAME]?: string;
  [ARG_FORCE]?: boolean;
}

/**
 * Remove an environment variable or secret from an Edge Script.
 *
 * When no name is provided, shows an interactive select list.
 * Prompts for confirmation before deleting (skipped with --force).
 *
 * @example
 * ```bash
 * # Remove by name
 * bunny scripts env remove MY_VAR
 *
 * # Interactive select
 * bunny scripts env remove
 *
 * # Skip confirmation
 * bunny scripts env remove MY_VAR --force
 *
 * # Short alias
 * bunny scripts env rm MY_VAR -f
 *
 * # Specify script ID
 * bunny scripts env remove MY_VAR --id 12345
 * ```
 */
export const scriptsEnvRemoveCommand = defineCommand<RemoveArgs>({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts env remove MY_VAR", "Remove by name"],
    ["$0 scripts env remove", "Interactive select"],
    ["$0 scripts env remove MY_VAR --force", "Skip confirmation"],
  ],

  builder: (yargs) =>
    scriptIdOptionBuilder(
      yargs.positional(ARG_NAME, {
        type: "string",
        describe: ARG_NAME_DESCRIPTION,
      }),
    ).option(ARG_FORCE, {
      alias: ARG_FORCE_ALIAS,
      type: "boolean",
      default: false,
      describe: ARG_FORCE_DESCRIPTION,
    }),

  handler: async ({
    [ARG_NAME]: rawName,
    id: rawId,
    [ARG_FORCE]: force,
    link,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const { id, offerLink } = await selectScript(client, {
      id: rawId,
      link,
      output,
    });

    const spin = spinner("Fetching environment variables...");
    spin.start();

    const entries = await fetchEnvEntries(client, id);

    spin.stop();

    if (entries.length === 0) {
      logger.info("No environment variables or secrets found.");
      await offerLink();
      return;
    }

    let name = rawName;
    if (!name) {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "Select a variable to remove:",
        choices: entries.map((e) => ({
          title: e.secret ? `${e.name} (secret)` : e.name,
          value: e.name,
        })),
      });
      name = value;
    }
    if (!name) {
      throw new UserError("Cancelled.");
    }

    const entry = entries.find(
      (e) => e.name.toUpperCase() === name?.toUpperCase(),
    );
    if (!entry) {
      throw new UserError(`No variable or secret named "${name}" found.`);
    }

    const confirmed = await confirm(
      `Remove ${entry.secret ? "secret" : "variable"} "${entry.name}"?`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const deleteSpin = spinner(`Removing "${entry.name}"...`);
    deleteSpin.start();

    if (entry.secret) {
      await client.DELETE("/compute/script/{id}/secrets/{secretId}", {
        params: { path: { id, secretId: entry.id } },
      });
    } else {
      await client.DELETE("/compute/script/{id}/variables/{variableId}", {
        params: { path: { id, variableId: entry.id } },
      });
    }

    deleteSpin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify({ name: entry.name, secret: entry.secret }, null, 2),
      );
      return;
    }

    logger.success(
      `Removed ${entry.secret ? "secret" : "variable"} "${entry.name}".`,
    );

    await offerLink();
  },
});
