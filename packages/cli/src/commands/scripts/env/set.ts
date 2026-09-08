import { createComputeClient } from "@bunny.net/openapi-client";
import { fetchEnvEntries } from "@/commands/scripts/api.ts";
import {
  type ScriptSelectorArgs,
  scriptIdOptionBuilder,
  selectScript,
} from "@/commands/scripts/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, spinner } from "@/core/ui.ts";
import { looksSecret, pushEnvFile, reportPush } from "./env-push.ts";

const COMMAND = "set [name] [value]";
const DESCRIPTION = "Set an environment variable or secret for an Edge Script.";

const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Variable name (will be uppercased)";
const ARG_VALUE = "value";
const ARG_VALUE_DESCRIPTION = "Variable value";
const ARG_SECRET = "secret";
const ARG_SECRET_DESCRIPTION = "Store as an encrypted secret";
const ARG_FROM_FILE = "from-file";
const ARG_FROM_FILE_DESCRIPTION =
  "Set every variable in a .env file (same as `scripts env push`)";

interface SetArgs extends ScriptSelectorArgs {
  [ARG_NAME]?: string;
  [ARG_VALUE]?: string;
  [ARG_SECRET]?: boolean;
  [ARG_FROM_FILE]?: string;
}

/**
 * Set an environment variable or secret for an Edge Script.
 *
 * Prompts interactively for missing name, value, and secret flag.
 * Secret values are masked during input. The name is automatically
 * uppercased. Errors if a variable/secret with the same name exists
 * as the opposite type.
 *
 * @example
 * ```bash
 * # Set a plain variable
 * bunny scripts env set MY_VAR "hello world"
 *
 * # Set a secret
 * bunny scripts env set API_KEY "sk-..." --secret
 *
 * # Interactive mode
 * bunny scripts env set
 *
 * # Specify script ID
 * bunny scripts env set MY_VAR "value" --id 12345
 * ```
 */
export const scriptsEnvSetCommand = defineCommand<SetArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ['$0 scripts env set MY_VAR "hello"', "Set a plain variable"],
    ['$0 scripts env set API_KEY "sk-…" --secret', "Set a secret"],
    [
      "$0 scripts env set --from-file .env",
      "Set every variable in a .env file",
    ],
    ["$0 scripts env set", "Interactive mode"],
  ],

  builder: (yargs) =>
    scriptIdOptionBuilder(
      yargs
        .positional(ARG_NAME, {
          type: "string",
          describe: ARG_NAME_DESCRIPTION,
        })
        .positional(ARG_VALUE, {
          type: "string",
          describe: ARG_VALUE_DESCRIPTION,
        }),
    )
      .option(ARG_SECRET, {
        type: "boolean",
        describe: ARG_SECRET_DESCRIPTION,
      })
      .option(ARG_FROM_FILE, {
        type: "string",
        describe: ARG_FROM_FILE_DESCRIPTION,
      }),

  handler: async ({
    [ARG_NAME]: rawName,
    [ARG_VALUE]: rawValue,
    id: rawId,
    [ARG_SECRET]: secret,
    [ARG_FROM_FILE]: fromFile,
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

    if (fromFile !== undefined) {
      if (rawName) {
        throw new UserError(
          "--from-file sets every variable in the file, so it takes no name.",
          `Drop the name, or run \`bunny scripts env push ${fromFile}\`.`,
        );
      }
      if (secret !== undefined) {
        throw new UserError(
          "--secret applies to one variable, not a whole file.",
          "Name the encrypted ones with --secrets, e.g. --secrets DB_TOKEN,API_KEY.",
        );
      }
      const results = await pushEnvFile(client, id, {
        file: fromFile || undefined,
        output,
      });
      if (output === "json") {
        logger.log(JSON.stringify(results, null, 2));
        return;
      }
      reportPush(results);
      await offerLink();
      return;
    }

    let name = rawName;
    if (!name) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Variable name:",
      });
      name = value;
    }
    if (!name) throw new UserError("Variable name is required.");

    // A prompted value has to say whether it is a secret; a value already on the
    // command line is a plain variable unless --secret says otherwise.
    let isSecret = secret;
    if (isSecret === undefined) {
      if (rawValue === undefined && isInteractive(output)) {
        const { confirmed } = await prompts({
          type: "confirm",
          name: "confirmed",
          message: "Is this a secret?",
          initial: looksSecret(name),
        });
        isSecret = confirmed ?? false;
      } else {
        isSecret = false;
      }
    }

    let value = rawValue;
    if (value === undefined) {
      const { value: prompted } = await prompts({
        type: isSecret ? "password" : "text",
        name: "value",
        message: isSecret ? "Secret value:" : "Variable value:",
      });
      value = prompted;
    }
    if (value === undefined) throw new UserError("Variable value is required.");

    name = name.toUpperCase();

    const spin = spinner("Checking for conflicts...");
    spin.start();

    // A name conflict is one held by the opposite type (variable vs secret).
    const conflict = (await fetchEnvEntries(client, id)).find(
      (e) => e.name.toUpperCase() === name && e.secret !== isSecret,
    );
    if (conflict) {
      spin.stop();
      throw new UserError(
        isSecret
          ? `A variable named "${name}" already exists. Remove it first to set it as a secret.`
          : `A secret named "${name}" already exists. Remove it first to set it as a variable.`,
      );
    }

    spin.text = isSecret ? "Setting secret..." : "Setting variable...";

    if (isSecret) {
      await client.PUT("/compute/script/{id}/secrets", {
        params: { path: { id } },
        body: { Name: name, Secret: value },
      });
    } else {
      await client.PUT("/compute/script/{id}/variables", {
        params: { path: { id } },
        body: { Name: name, DefaultValue: value },
      });
    }

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ name, secret: isSecret }, null, 2));
      return;
    }

    logger.success(
      isSecret
        ? `Secret "${name}" set successfully.`
        : `Variable "${name}" set to "${value}".`,
    );

    await offerLink();
  },
});
