import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { writeRemoteState } from "./api.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  sitePositionalBuilder,
} from "./interactive.ts";
import { ROUTER_VERSION, routerSource } from "./router/source.ts";

interface UpgradeArgs extends SiteSelectorArgs {
  force?: boolean;
}

/**
 * Republish the site's router script at the CLI's current version. Deploys and
 * env vars are untouched — only the router code changes.
 */
export const sitesUpgradeRouterCommand = defineCommand<UpgradeArgs>({
  command: "upgrade-router [site]",
  describe: "Upgrade a site's router script to the latest version.",
  examples: [
    ["$0 sites upgrade-router", "Upgrade the linked site's router"],
    [
      "$0 sites upgrade-router my-site --force",
      "Republish even when up to date",
    ],
  ],

  builder: (yargs) =>
    sitePositionalBuilder(yargs).option("force", {
      alias: "f",
      type: "boolean",
      describe: "Republish the router even if it's already current",
    }),

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
    const { state, connection, etag } = site;

    if (state.routerVersion >= ROUTER_VERSION && !args.force) {
      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              site: state.name,
              routerVersion: state.routerVersion,
              upgraded: false,
            },
            null,
            2,
          ),
        );
        return;
      }
      logger.info(
        `Router is already at v${state.routerVersion} — nothing to upgrade.`,
      );
      return;
    }

    const from = state.routerVersion;
    const spin = spinner(`Upgrading router v${from} → v${ROUTER_VERSION}...`);
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
      state.routerVersion = ROUTER_VERSION;
      await writeRemoteState(connection, state, etag);
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            site: state.name,
            routerVersion: ROUTER_VERSION,
            upgraded: true,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Router upgraded to v${ROUTER_VERSION}.`);

    await offerLink();
  },
});
