import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, removeManifest } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { deleteSiteResources } from "./api.ts";
import { SITES_MANIFEST, type SiteManifest } from "./constants.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  sitePositionalBuilder,
} from "./interactive.ts";

interface DeleteArgs extends SiteSelectorArgs {
  force?: boolean;
  "keep-storage"?: boolean;
}

/**
 * Delete a site: its pull zone, router script, and (unless --keep-storage)
 * the storage zone with every deploy in it. Requires typing the site name
 * to confirm unless --force is passed.
 */
export const sitesDeleteCommand = defineCommand<DeleteArgs>({
  command: "delete [site]",
  describe: "Delete a site and its resources.",
  examples: [
    ["$0 sites delete my-site", "Interactive — double confirmation"],
    ["$0 sites delete my-site --force", "Skip confirmation"],
    [
      "$0 sites delete my-site --keep-storage",
      "Keep the storage zone (and all deploy files)",
    ],
  ],

  builder: (yargs) =>
    sitePositionalBuilder(yargs)
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompts",
      })
      .option("keep-storage", {
        type: "boolean",
        default: false,
        describe: "Delete the pull zone and router but keep the storage zone",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey, force } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    const { site } = await selectSite(coreClient, {
      site: args.site,
      link: false,
      output,
    });
    const { state } = site;

    const what = args["keep-storage"]
      ? "its pull zone and router"
      : "its pull zone, router, and ALL deploy files";
    const confirmed = await confirm(
      `Delete site "${state.name}" (${what})? This cannot be undone.`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    if (!force) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: `Type "${state.name}" to confirm:`,
      });
      if (value !== state.name) {
        logger.log("Cancelled.");
        return;
      }
    }

    const spin = spinner("Deleting site resources...");
    spin.start();
    let results: Awaited<ReturnType<typeof deleteSiteResources>>;
    try {
      results = await deleteSiteResources({
        coreClient,
        computeClient,
        state,
        keepStorage: args["keep-storage"],
      });
    } finally {
      spin.stop();
    }

    // Only drop the local link when it pointed at this site.
    const manifest = loadManifest<SiteManifest>(SITES_MANIFEST);
    if (manifest.id === state.storageZoneId) {
      removeManifest(SITES_MANIFEST);
    }

    const failures = results.filter((r) => !r.deleted);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { name: state.name, deleted: failures.length === 0, results },
          null,
          2,
        ),
      );
      if (failures.length > 0) process.exit(1);
      return;
    }

    for (const result of results) {
      if (result.deleted) {
        logger.success(`Deleted ${result.resource} ${result.id}.`);
      } else {
        logger.warn(
          `Couldn't delete ${result.resource} ${result.id}: ${result.error}`,
        );
      }
    }
    if (args["keep-storage"]) {
      logger.info(
        `Storage zone ${state.storageZoneId} was kept, including all deploy files.`,
      );
    }
    if (failures.length > 0) {
      logger.dim("  Re-run the command to retry the failed deletions.");
      process.exit(1);
    }
  },
});
