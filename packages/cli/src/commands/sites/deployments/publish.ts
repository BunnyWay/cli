import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "../../../core/ui.ts";
import { promoteDeploy, readRemoteState, writeRemoteState } from "../api.ts";
import { findDeploy, markCurrent } from "../constants.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteLinkOption,
  siteOptionBuilder,
} from "../interactive.ts";

interface PublishArgs extends SiteSelectorArgs {
  id?: string;
  previous?: boolean;
  force?: boolean;
}

// Publish (promote) a past deploy as production: flips the router's env var and purges the cache, no files move (instant rollback).
export const sitesDeploymentsPublishCommand = defineCommand<PublishArgs>({
  command: "publish [id]",
  aliases: ["promote"],
  describe: "Publish (roll back to) a past deploy.",
  examples: [
    ["$0 sites deployments publish a1b2c3d4", "Promote a deploy by ID"],
    ["$0 sites deployments publish --previous", "Instant rollback"],
    ["$0 sites deployments publish a1b2c3d4 --force", "Skip confirmation"],
  ],

  builder: (yargs) =>
    siteLinkOption(
      siteOptionBuilder(
        yargs.positional("id", {
          type: "string",
          describe: "Deploy ID to publish (see `sites deployments list`)",
        }),
      )
        .option("previous", {
          type: "boolean",
          describe: "Publish the previous deploy (instant rollback)",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          describe: "Skip the confirmation prompt",
        }),
    ),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    const { site, offerLink } = await selectSite(coreClient, {
      site: args.site,
      link: args.link,
      output,
      force: args.force,
    });
    // No etag kept from this read: the destructive phase re-reads state and writes with the fresh one.
    const { state, connection } = site;

    let targetId = args.id;
    if (args.previous) {
      if (targetId) {
        throw new UserError("Pass either a deploy ID or --previous, not both.");
      }
      if (!state.previous) {
        throw new UserError(
          "No previous deploy to roll back to.",
          "See `bunny sites deployments list` for available deploys.",
        );
      }
      targetId = state.previous;
    }
    if (!targetId) {
      throw new UserError(
        "A deploy ID is required.",
        "Pass an ID from `bunny sites deployments list`, or --previous to roll back.",
      );
    }

    const { deploy, caseVariant } = findDeploy(state.deploys, targetId);
    if (!deploy) {
      throw new UserError(
        `Deploy ${targetId} not found for site ${state.name}.`,
        caseVariant
          ? `Did you mean ${caseVariant.id}? Deploy IDs are case-sensitive.`
          : "Run `bunny sites deployments list` to see available deploys.",
      );
    }
    if (state.current === targetId) {
      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              site: state.name,
              id: targetId,
              published: false,
              unchanged: true,
            },
            null,
            2,
          ),
        );
        return;
      }
      logger.info(`Deploy ${targetId} is already live.`);
      return;
    }

    requireConfirmable(output, {
      force: args.force,
      message: `Publishing ${targetId} needs a confirmation prompt.`,
      hint: "Re-run with --force to publish non-interactively.",
    });
    const proceed = await confirm(
      `Publish deploy ${targetId} as production for ${state.name}?`,
      { force: args.force },
    );
    if (!proceed) {
      logger.log("Cancelled.");
      return;
    }

    await withSpinner("Publishing...", async () => {
      // Revalidate on fresh state right before promoting: the confirmation window is long enough for a concurrent replace to have dropped this deploy's record and started rewriting its files.
      const fresh = await readRemoteState(connection);
      if (!fresh) {
        throw new UserError(
          "Couldn't re-read the site state.",
          "Retry the publish; nothing was changed.",
        );
      }
      const { state: latest, etag: latestEtag } = fresh;
      if (!latest.deploys.some((d) => d.id === targetId)) {
        throw new UserError(
          `Deploy ${targetId} is gone from ${latest.name} (a concurrent replace or delete?) and can't be published.`,
          "Run `bunny sites deployments list` and retry.",
        );
      }
      await promoteDeploy({
        computeClient,
        coreClient,
        state: latest,
        deployId: targetId,
      });
      markCurrent(latest, targetId);
      await writeRemoteState(connection, latest, latestEtag, {
        promotedTo: targetId,
      });
    });

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { site: state.name, id: targetId, published: true },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Deploy ${targetId} is now live.`);
    if (state.domain) logger.info(`Production: https://${state.domain}`);

    await offerLink();
  },
});
