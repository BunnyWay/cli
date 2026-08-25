import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { errorMessage, UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "../../../core/ui.ts";
import {
  deleteDeployFiles,
  readRemoteState,
  writeRemoteState,
} from "../api.ts";
import { isValidDeployId, type RemoteSiteState } from "../constants.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteOptionBuilder,
} from "../interactive.ts";

interface DeleteArgs extends SiteSelectorArgs {
  id?: string;
  force?: boolean;
}

// The guard that makes `delete` safe to automate: the live deploy and the rollback target are never deletable, and `--force` only skips the confirmation, never this.
export function deleteBlocker(
  state: Pick<RemoteSiteState, "current" | "previous">,
  id: string,
): string | undefined {
  if (id === state.current) return "the live production deploy";
  if (id === state.previous) return "the rollback target";
  return undefined;
}

// Delete one deploy: its files, then its record. Deleting an ID that's already gone is a no-op success, so re-runs converge. Retention cleanup stays with `prune`.
export const sitesDeploymentsDeleteCommand = defineCommand<DeleteArgs>({
  command: "delete [id]",
  describe: "Delete a deploy.",
  examples: [
    ["$0 sites deployments delete a1b2c3d4", "Delete a deploy by ID"],
    [
      "$0 sites deployments delete a1b2c3d4 --site my-site --force",
      "Non-interactive deletion",
    ],
  ],

  builder: (yargs) =>
    siteOptionBuilder(
      yargs.positional("id", {
        type: "string",
        describe: "Deploy ID to delete (see `sites deployments list`)",
      }),
    ).option("force", {
      alias: "f",
      type: "boolean",
      describe: "Skip the confirmation prompt",
    }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;

    const id = args.id;
    if (!id) {
      throw new UserError(
        "A deploy ID is required.",
        "Pass an ID from `bunny sites deployments list`.",
      );
    }
    // Never interpolate an unvalidated ID into a storage path.
    if (!isValidDeployId(id)) {
      throw new UserError(
        `Invalid deploy ID: ${id}`,
        "See `bunny sites deployments list` for available deploys.",
      );
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { site } = await selectSite(client, {
      site: args.site,
      link: false,
      output,
      force: args.force,
    });
    // No etag here: the destructive phase re-reads state and writes with the fresh one.
    const { state, connection } = site;

    const record = state.deploys.find((d) => d.id === id);
    if (!record) {
      // Idempotent for CI: a retry after a successful delete still exits 0.
      if (output === "json") {
        logger.log(
          JSON.stringify({ site: state.name, id, deleted: false }, null, 2),
        );
        return;
      }
      logger.info(
        `Deploy ${id} not found on ${state.name}; nothing to delete.`,
      );
      return;
    }

    const blocker = deleteBlocker(state, id);
    if (blocker) {
      throw new UserError(
        `Deploy ${id} is ${blocker} and can't be deleted.`,
        "Publish another deploy first, or use `sites deployments prune` for retention cleanup.",
      );
    }

    requireConfirmable(output, {
      force: args.force,
      message: `Deleting deploy ${id} needs a confirmation prompt.`,
      hint: "Re-run with --force to delete non-interactively.",
    });
    const proceed = await confirm(`Delete deploy ${id} from ${state.name}?`, {
      force: args.force,
    });
    if (!proceed) {
      logger.log("Cancelled.");
      return;
    }

    const deleted = await withSpinner(`Deleting deploy ${id}...`, async () => {
      // Revalidate on fresh state right before anything destructive: the confirmation window is long enough for a concurrent deploy to make this one live.
      const fresh = await readRemoteState(connection);
      if (fresh === null) {
        throw new UserError(
          "Couldn't re-read the site state.",
          "Retry the delete; nothing was deleted.",
        );
      }
      const { state: latest, etag: latestEtag } = fresh;
      const freshRecord = latest.deploys.find((d) => d.id === id);
      if (!freshRecord) return false; // gone since the first read; same no-op as above
      const freshBlocker = deleteBlocker(latest, id);
      if (freshBlocker) {
        throw new UserError(
          `Deploy ${id} became ${freshBlocker} and can't be deleted.`,
          "Publish another deploy first, or use `sites deployments prune` for retention cleanup.",
        );
      }

      await deleteDeployFiles(connection, id);
      latest.deploys = latest.deploys.filter((d) => d.id !== id);
      await writeRemoteState(connection, latest, latestEtag, {
        removedIds: [id],
      });
      return true;
    });

    if (output === "json") {
      logger.log(JSON.stringify({ site: state.name, id, deleted }, null, 2));
      return;
    }
    if (deleted) {
      logger.success(`Deleted deploy ${id}.`);
    } else {
      logger.info(
        `Deploy ${id} not found on ${state.name}; nothing to delete.`,
      );
    }
  },
});
