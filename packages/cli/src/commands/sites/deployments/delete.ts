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
    const { state, connection, etag } = site;

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

    await withSpinner(`Deleting deploy ${id}...`, async () => {
      // Same order as prune. One listing backfills a record that lost its zone id and catches duplicate zones a concurrent same-id deploy left behind.
      let discovered: number[] | undefined;
      try {
        discovered = (await findPreviewZones(client, state.storageZoneId))
          .filter((z) => z.deployId === id)
          .map((z) => z.id);
      } catch (err) {
        discovered = undefined;
        logger.warn(`Couldn't list preview zones: ${errorMessage(err)}`);
      }
      // With the listing down, a record without a zone id can't prove its zone doesn't exist; keep it so a retry converges instead of stranding an orphan.
      if (discovered === undefined && record.previewZoneId === undefined) {
        throw new UserError(
          `Couldn't check deploy ${id} for a preview zone.`,
          "Retry the delete; the deploy record was kept.",
        );
      }
      // Zones first: a failed zone deletion keeps the record (and files), so a retry picks the zone back up instead of orphaning it until site delete.
      const zoneIds = new Set([
        ...(record.previewZoneId !== undefined ? [record.previewZoneId] : []),
        ...(discovered ?? []),
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
      state.deploys = state.deploys.filter((d) => d.id !== id);
      await writeRemoteState(connection, state, etag, { removedIds: [id] });
    });

    if (output === "json") {
      logger.log(
        JSON.stringify({ site: state.name, id, deleted: true }, null, 2),
      );
      return;
    }
    logger.success(`Deleted deploy ${id}.`);
  },
});
