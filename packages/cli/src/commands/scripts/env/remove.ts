import { createComputeClient } from "@bunny.net/api";
import type { components } from "@bunny.net/api/generated/compute.d.ts";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { resolveManifestId } from "../../../core/manifest.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { SCRIPT_MANIFEST } from "../constants.ts";

type EdgeScriptVariable = components["schemas"]["EdgeScriptVariableModel"];
type EdgeScriptSecret = components["schemas"]["EdgeScriptSecretModel"];

const COMMAND = "remove [name]";
const ALIASES = ["rm"] as const;
const DESCRIPTION =
  "Remove an environment variable or secret from an Edge Script.";

const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Variable or secret name to remove";
const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";
const ARG_FORCE = "force";
const ARG_FORCE_ALIAS = "f";
const ARG_FORCE_DESCRIPTION = "Skip confirmation prompt";

interface RemoveArgs {
  [ARG_NAME]?: string;
  [ARG_ID]?: number;
  [ARG_FORCE]?: boolean;
}

interface EnvEntry {
  id: number;
  name: string;
  secret: boolean;
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
    yargs
      .positional(ARG_NAME, {
        type: "string",
        describe: ARG_NAME_DESCRIPTION,
      })
      .option(ARG_ID, {
        type: "number",
        describe: ARG_ID_DESCRIPTION,
      })
      .option(ARG_FORCE, {
        alias: ARG_FORCE_ALIAS,
        type: "boolean",
        default: false,
        describe: ARG_FORCE_DESCRIPTION,
      }),

  handler: async ({
    [ARG_NAME]: rawName,
    [ARG_ID]: rawId,
    [ARG_FORCE]: force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");
    const config = resolveConfig(profile, apiKey);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Fetching environment variables...");
    spin.start();

    const [scriptResult, secretsResult] = await Promise.all([
      client.GET("/compute/script/{id}", {
        params: { path: { id } },
      }),
      client.GET("/compute/script/{id}/secrets", {
        params: { path: { id } },
      }),
    ]);

    spin.stop();

    const variables = scriptResult.data?.EdgeScriptVariables ?? [];
    const secrets = secretsResult.data?.Secrets ?? [];

    const entries: EnvEntry[] = [
      ...variables.map((v: EdgeScriptVariable) => ({
        id: v.Id ?? 0,
        name: v.Name ?? "",
        secret: false,
      })),
      ...secrets.map((s: EdgeScriptSecret) => ({
        id: s.Id ?? 0,
        name: s.Name ?? "",
        secret: true,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    if (entries.length === 0) {
      logger.info("No environment variables or secrets found.");
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
      logger.log("Cancelled.");
      return;
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
  },
});
