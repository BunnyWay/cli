import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  sitePositionalBuilder,
} from "./interactive.ts";
import { routerSource } from "./router/source.ts";

type UpgradeArgs = SiteSelectorArgs;

/**
 * Republish the site's router script with the CLI's current source. Deploys and
 * env vars are untouched — only the router code changes.
 */
export const sitesUpgradeRouterCommand = defineCommand<UpgradeArgs>({
  command: "upgrade-router [site]",
  describe: "Republish a site's router script with the latest version.",
  examples: [
    ["$0 sites upgrade-router", "Republish the linked site's router"],
    ["$0 sites upgrade-router my-site", "Republish a specific site's router"],
  ],

  builder: (yargs) => sitePositionalBuilder(yargs),

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
    });
    const { state } = site;

    const spin = spinner("Republishing router...");
    spin.start();
    try {
      await computeClient.POST("/compute/script/{id}/code", {
        params: { path: { id: state.scriptId } },
        body: { Code: routerSource() },
      });
      await computeClient.POST("/compute/script/{id}/publish", {
        params: { path: { id: state.scriptId, uuid: null } },
        body: {},
      });
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(
        JSON.stringify({ site: state.name, republished: true }, null, 2),
      );
      return;
    }

    logger.success("Router republished.");

    await offerLink();
  },
});
