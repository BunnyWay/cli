import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { errorMessage } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "../../../core/ui.ts";
import { deleteDeployFiles, writeRemoteState } from "../api.ts";
import {
  DEFAULT_KEEP_DEPLOYS,
  isValidDeployId,
  pruneVictims,
} from "../constants.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteOptionBuilder,
} from "../interactive.ts";

interface PruneArgs extends SiteSelectorArgs {
  keep?: number;
  force?: boolean;
}

export const sitesDeploymentsPruneCommand = defineCommand<PruneArgs>({
  command: "prune",
  describe: "Delete old deploys, keeping the most recent ones.",
  examples: [
    [
      "$0 sites deployments prune",
      `Keep the ${DEFAULT_KEEP_DEPLOYS} newest deploys`,
    ],
    ["$0 sites deployments prune --keep 10", "Keep the 10 newest deploys"],
    ["$0 sites deployments prune --force", "Skip confirmation"],
  ],

  builder: (yargs) =>
    siteOptionBuilder(yargs)
      .option("keep", {
        type: "number",
        default: DEFAULT_KEEP_DEPLOYS,
        describe:
          "Number of recent deploys to keep (current and previous are always kept)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Skip the confirmation prompt",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { site } = await selectSite(client, {
      site: args.site,
      link: false,
      output,
      force: args.force,
    });
    const { state, connection, etag } = site;

    const victims = pruneVictims(
      state.deploys,
      args.keep ?? DEFAULT_KEEP_DEPLOYS,
      state.current,
      state.previous,
    );

    if (victims.length === 0) {
      if (output === "json") {
        logger.log(JSON.stringify({ site: state.name, pruned: [] }, null, 2));
        return;
      }
      logger.info("Nothing to prune.");
      return;
    }

    requireConfirmable(output, {
      force: args.force,
      message: `Pruning ${victims.length} deploy(s) needs a confirmation prompt.`,
      hint: "Re-run with --force to prune non-interactively.",
    });
    const proceed = await confirm(
      `Delete ${victims.length} old deploy(s) from ${state.name} (${victims
        .map((v) => v.id)
        .join(", ")})?`,
      { force: args.force },
    );
    if (!proceed) {
      logger.log("Cancelled.");
      return;
    }

    const failures: Array<{ id: string; error: string }> = [];
    await withSpinner("Pruning deploys...", async (spin) => {
      const pruned = new Set<string>();
      for (const [index, victim] of victims.entries()) {
        spin.text = `Pruning ${victim.id} (${index + 1}/${victims.length})...`;
        try {
          // Never interpolate an unvalidated ID into a storage path.
          if (!isValidDeployId(victim.id)) {
            failures.push({ id: victim.id, error: "Invalid deploy ID." });
            continue;
          }
          await deleteDeployFiles(connection, victim.id);
          pruned.add(victim.id);
        } catch (err) {
          failures.push({ id: victim.id, error: errorMessage(err) });
        }
      }
      // Only forget deploys whose files are actually gone.
      state.deploys = state.deploys.filter((d) => !pruned.has(d.id));
      await writeRemoteState(connection, state, etag, {
        removedIds: [...pruned],
      });
    });

    const prunedIds = victims
      .filter((v) => !failures.some((f) => f.id === v.id))
      .map((v) => v.id);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { site: state.name, pruned: prunedIds, failures },
          null,
          2,
        ),
      );
      if (failures.length > 0) process.exit(1);
      return;
    }

    if (prunedIds.length > 0) {
      logger.success(
        `Pruned ${prunedIds.length} deploy(s): ${prunedIds.join(", ")}.`,
      );
    }
    for (const failure of failures) {
      logger.warn(`Couldn't prune ${failure.id}: ${failure.error}`);
    }
    if (failures.length > 0) process.exit(1);
  },
});
