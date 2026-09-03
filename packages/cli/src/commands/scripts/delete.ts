import { createComputeClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { resolveManifestId } from "@/core/manifest.ts";
import { confirm, confirmTyped, spinner } from "@/core/ui.ts";
import { fetchScript } from "./api.ts";
import { SCRIPT_MANIFEST } from "./constants.ts";

type EdgeScript = components["schemas"]["EdgeScriptModel"];

const COMMAND = "delete [id]";
const DESCRIPTION = "Delete an Edge Script.";

const ARG_ID = "id";
const ARG_FORCE = "force";

interface DeleteArgs {
  [ARG_ID]?: EdgeScript["Id"];
  [ARG_FORCE]?: boolean;
}

/**
 * Permanently delete an Edge Script.
 *
 * This is a destructive, irreversible operation. The script and all its
 * deployments, environment variables, and secrets will be permanently removed.
 *
 * Requires two confirmations unless `--force` is passed:
 * 1. A yes/no confirmation prompt
 * 2. Typing the script name to verify
 *
 * @example
 * ```bash
 * # Interactive — double confirmation
 * bunny scripts delete 12345
 *
 * # Delete linked script
 * bunny scripts delete
 *
 * # Skip confirmation prompts
 * bunny scripts delete 12345 --force
 *
 * # JSON output for scripting
 * bunny scripts delete 12345 --force --output json
 * ```
 */
export const scriptsDeleteCommand = defineCommand<DeleteArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts delete 12345", "Interactive — double confirmation"],
    ["$0 scripts delete", "Delete linked script"],
    ["$0 scripts delete 12345 --force", "Skip confirmation"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_ID, {
        type: "number",
        describe: "Edge Script ID (uses linked script if omitted)",
      })
      .option(ARG_FORCE, {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompts",
      }),

  handler: async ({
    [ARG_ID]: rawId,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const fetchSpin = spinner("Fetching Edge Script...");
    fetchSpin.start();

    const script = await fetchScript(client, id);

    fetchSpin.stop();

    const confirmed =
      (await confirm(
        `Delete Edge Script "${script.Name}" (${id})? This cannot be undone.`,
        { force },
      )) && (await confirmTyped(script.Name ?? "", { force }));

    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const deleteSpin = spinner("Deleting Edge Script...");
    deleteSpin.start();

    await client.DELETE("/compute/script/{id}", {
      params: { path: { id } },
    });

    deleteSpin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ id, deleted: true }, null, 2));
      return;
    }

    logger.success(`Edge Script "${script.Name}" (${id}) deleted.`);
  },
});
