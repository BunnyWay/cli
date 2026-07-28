import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import {
  formatBytes,
  formatDateTime,
  formatTable,
} from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteLinkOption,
  sitePositionalBuilder,
} from "../interactive.ts";

type ListArgs = SiteSelectorArgs;

export const sitesDeploymentsListCommand = defineCommand<ListArgs>({
  command: "list [site]",
  aliases: ["ls"],
  describe: "List a site's deploys.",
  examples: [
    ["$0 sites deployments list", "List deploys for the linked site"],
    ["$0 sites deployments list my-site", "List deploys for a specific site"],
    ["$0 sites deployments list --output json", "JSON output"],
  ],

  builder: (yargs) => siteLinkOption(sitePositionalBuilder(yargs)),

  handler: async ({ site: ref, link, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { site, offerLink } = await selectSite(client, {
      site: ref,
      link,
      output,
    });
    const { state } = site;

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            site: state.name,
            current: state.current ?? null,
            previous: state.previous ?? null,
            deploys: state.deploys,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (state.deploys.length === 0) {
      logger.info("No deploys yet.");
      logger.dim("  Deploy with `bunny sites deploy <dir>`.");
      await offerLink();
      return;
    }

    logger.info(`Deploys for ${state.name}:`);
    logger.log();
    logger.log(
      formatTable(
        ["ID", "Status", "Created", "Source", "Files", "Size"],
        state.deploys.map((d) => [
          d.id,
          d.id === state.current
            ? "● Live"
            : d.id === state.previous
              ? "○ Previous"
              : "○",
          formatDateTime(d.createdAt),
          d.source === "git"
            ? `git ${d.gitSha ?? d.id}`
            : `content${d.dirty ? " (dirty tree)" : ""}`,
          String(d.files),
          formatBytes(d.bytes),
        ]),
        output,
      ),
    );

    await offerLink();
  },
});
