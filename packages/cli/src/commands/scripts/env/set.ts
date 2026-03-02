import type { components } from "@bunny.net/api/generated/compute.d.ts";
import { createComputeClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { resolveManifestId } from "../../../core/manifest.ts";
import { spinner } from "../../../core/ui.ts";
import { SCRIPT_MANIFEST } from "../constants.ts";
import prompts from "prompts";
import { clientOptions } from "../../../core/client-options.ts";

type EdgeScriptVariable = components["schemas"]["EdgeScriptVariableModel"];
type EdgeScriptSecret = components["schemas"]["EdgeScriptSecretModel"];

const COMMAND = "set [name] [value]";
const DESCRIPTION =
  "Set an environment variable or secret for an Edge Script.";

const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Variable name (will be uppercased)";
const ARG_VALUE = "value";
const ARG_VALUE_DESCRIPTION = "Variable value";
const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";
const ARG_SECRET = "secret";
const ARG_SECRET_DESCRIPTION = "Store as an encrypted secret";

interface SetArgs {
  [ARG_NAME]?: string;
  [ARG_VALUE]?: string;
  [ARG_ID]?: number;
  [ARG_SECRET]?: boolean;
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

  builder: (yargs) =>
    yargs
      .positional(ARG_NAME, {
        type: "string",
        describe: ARG_NAME_DESCRIPTION,
      })
      .positional(ARG_VALUE, {
        type: "string",
        describe: ARG_VALUE_DESCRIPTION,
      })
      .option(ARG_ID, {
        type: "number",
        describe: ARG_ID_DESCRIPTION,
      })
      .option(ARG_SECRET, {
        type: "boolean",
        describe: ARG_SECRET_DESCRIPTION,
      }),

  handler: async ({
    [ARG_NAME]: rawName,
    [ARG_VALUE]: rawValue,
    [ARG_ID]: rawId,
    [ARG_SECRET]: secret,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");

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

    let isSecret = secret;
    if (isSecret === undefined) {
      const { confirmed } = await prompts({
        type: "confirm",
        name: "confirmed",
        message: "Is this a secret?",
        initial: false,
      });
      isSecret = confirmed ?? false;
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

    const config = resolveConfig(profile, apiKey);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Checking for conflicts...");
    spin.start();

    const [scriptResult, secretsResult] = await Promise.all([
      client.GET("/compute/script/{id}", {
        params: { path: { id } },
      }),
      client.GET("/compute/script/{id}/secrets", {
        params: { path: { id } },
      }),
    ]);

    const existingVars = scriptResult.data?.EdgeScriptVariables ?? [];
    const existingSecrets = secretsResult.data?.Secrets ?? [];

    if (isSecret) {
      const conflict = existingVars.find(
        (v: EdgeScriptVariable) => v.Name?.toUpperCase() === name,
      );
      if (conflict) {
        spin.stop();
        throw new UserError(
          `A variable named "${name}" already exists. Remove it first to set it as a secret.`,
        );
      }
    } else {
      const conflict = existingSecrets.find(
        (s: EdgeScriptSecret) => s.Name?.toUpperCase() === name,
      );
      if (conflict) {
        spin.stop();
        throw new UserError(
          `A secret named "${name}" already exists. Remove it first to set it as a variable.`,
        );
      }
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
  },
});
