import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { errorMessage, UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "../../../core/ui.ts";
import {
  deleteDeployFiles,
  deletePreviewZone,
  findPreviewZones,
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

// The guard that makes `delete` safe to automate: the live deploy and the rollback target are never deletable, and `--force` only skips the confirmation, never this. It also covers the fast-forward-merge case where a PR preview's ID *is* the deploy that was just promoted.
export function deleteBlocker(
  state: Pick<RemoteSiteState, "current" | "previous">,
  id: string,
): string | undefined {
  if (id === state.current) return "the live production deploy";
  if (id === state.previous) return "the rollback target";
  return undefined;
}

// Delete one deploy: its preview zone(s) first, then its files, then the record. Built for CI cleanup of a merged/closed PR's preview, so deleting an ID that's already gone is a no-op success and re-runs converge. Retention cleanup stays with `prune`.
export const sitesDeploymentsDeleteCommand = defineCommand<DeleteArgs>({
  command: "delete [id]",
  describe: "Delete a deploy and its preview URL.",
  examples: [
    ["$0 sites deployments delete a1b2c3d4", "Delete a deploy by ID"],
    [
      "$0 sites deployments delete a1b2c3d4 --site my-site --force",
      "Non-interactive (CI) deletion",
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
    const proceed = await confirm(
      `Delete deploy ${id} (and its preview URL) from ${state.name}?`,
      { force: args.force },
    );
    if (!proceed) {
      logger.log("Cancelled.");
      return;
    }

    const deleted = await withSpinner(`Deleting deploy ${id}...`, async () => {
      // Revalidate on fresh state right before anything destructive: the confirmation window is long enough for a concurrent publish to make this deploy live (on a fast-forward merge, PR-close cleanup and the production deploy carry the same sha).
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

      // Same order as prune. One listing backfills a record that lost its zone id and catches duplicate zones a concurrent same-id deploy left behind. Unlike prune, a delete forgets the record for good, so a stranded duplicate would never be retried: a failed listing always aborts.
      let discovered: number[];
      try {
        discovered = (await findPreviewZones(client, latest.storageZoneId))
          .filter((z) => z.deployId === id)
          .map((z) => z.id);
      } catch (err) {
        throw new UserError(
          `Couldn't check deploy ${id} for preview zones: ${errorMessage(err)}`,
          "Retry the delete; the deploy record was kept.",
        );
      }
      // Zones first: a failed zone deletion keeps the record (and files), so a retry picks the zone back up instead of orphaning it until site delete.
      const zoneIds = new Set([
        ...(freshRecord.previewZoneId !== undefined
          ? [freshRecord.previewZoneId]
          : []),
        ...discovered,
      ]);
      for (const zoneId of zoneIds) {
        if (!(await deletePreviewZone(client, zoneId))) {
          throw new UserError(
            `The preview zone for deploy ${id} couldn't be deleted.`,
            "Retry the delete; the deploy record was kept.",
          );
        }
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
