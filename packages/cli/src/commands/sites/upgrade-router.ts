import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { errorMessage } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { withSpinner } from "../../core/ui.ts";
import { writeRemoteState } from "./api.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteLinkOption,
  sitePositionalBuilder,
} from "./interactive.ts";
import { ROUTER_VERSION, routerSource } from "./router/source.ts";

type UpgradeArgs = SiteSelectorArgs;

// Republish the site's router script with the CLI's current source; deploys and env vars are untouched, only the router code changes.
export const sitesUpgradeRouterCommand = defineCommand<UpgradeArgs>({
  command: "upgrade-router [site]",
  describe: "Republish a site's router script with the latest version.",
  examples: [
    ["$0 sites upgrade-router", "Republish the linked site's router"],
    ["$0 sites upgrade-router my-site", "Republish a specific site's router"],
  ],

  builder: (yargs) => siteLinkOption(sitePositionalBuilder(yargs)),

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

    await withSpinner("Republishing router...", async () => {
      await computeClient.POST("/compute/script/{id}/code", {
        params: { path: { id: state.scriptId } },
        body: { Code: routerSource },
      });
      await computeClient.POST("/compute/script/{id}/publish", {
        params: { path: { id: state.scriptId, uuid: null } },
        body: {},
      });
    });

    // Record the published generation so deploy stops re-upgrading; best-effort (a missed write just republishes next deploy).
    if (state.routerVersion !== ROUTER_VERSION) {
      state.routerVersion = ROUTER_VERSION;
      try {
        site.etag = await writeRemoteState(site.connection, state, site.etag);
      } catch (err) {
        logger.warn(`Couldn't record the router version: ${errorMessage(err)}`);
      }
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
