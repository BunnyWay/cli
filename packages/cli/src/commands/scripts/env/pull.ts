import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { components } from "@bunny.net/api/generated/compute.d.ts";
import { createComputeClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { manifestDir, resolveManifestId } from "../../../core/manifest.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { SCRIPT_MANIFEST } from "../constants.ts";
import { clientOptions } from "../../../core/client-options.ts";

type EdgeScriptVariable = components["schemas"]["EdgeScriptVariableModel"];

const COMMAND = "pull [id]";
const DESCRIPTION = "Pull environment variables to a local .env file.";

const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "Edge Script ID (uses linked script if omitted)";
const ARG_FORCE = "force";
const ARG_FORCE_ALIAS = "f";
const ARG_FORCE_DESCRIPTION = "Overwrite existing .env file without prompting";

interface PullArgs {
  [ARG_ID]?: number;
  [ARG_FORCE]?: boolean;
}

/**
 * Pull environment variables from an Edge Script to a local `.bunny/.env` file.
 *
 * Writes each variable as a `NAME=VALUE` line. Secrets are not included
 * because their values cannot be read back from the API.
 *
 * @example
 * ```bash
 * # Pull for linked script
 * bunny scripts env pull
 *
 * # Pull by script ID
 * bunny scripts env pull 12345
 *
 * # Overwrite without prompting
 * bunny scripts env pull --force
 * ```
 */
export const scriptsEnvPullCommand = defineCommand<PullArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional(ARG_ID, {
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

    const { data: script } = await client.GET("/compute/script/{id}", {
      params: { path: { id } },
    });

    spin.stop();

    const variables = script?.EdgeScriptVariables ?? [];

    if (output === "json") {
      logger.log(
        JSON.stringify(
          variables.map((v: EdgeScriptVariable) => ({
            name: v.Name ?? "",
            value: v.DefaultValue ?? "",
          })),
          null,
          2,
        ),
      );
      return;
    }

    if (variables.length === 0) {
      logger.info("No environment variables found.");
      logger.warn(
        "Secrets are not included — their values cannot be read from the API.",
      );
      return;
    }

    const dir = manifestDir(SCRIPT_MANIFEST);
    const envPath = join(dir, ".env");

    if (existsSync(envPath)) {
      const confirmed = await confirm(
        `File ${envPath} already exists. Overwrite?`,
        { force },
      );
      if (!confirmed) {
        logger.log("Cancelled.");
        return;
      }
    }

    const content =
      variables
        .map(
          (v: EdgeScriptVariable) =>
            `${v.Name ?? ""}=${v.DefaultValue ?? ""}`,
        )
        .join("\n") + "\n";

    mkdirSync(dir, { recursive: true });
    writeFileSync(envPath, content, { mode: 0o600 });

    logger.success(`Wrote ${variables.length} variable(s) to ${envPath}`);
    logger.warn(
      "Secrets are not included — their values cannot be read from the API.",
    );
  },
});
