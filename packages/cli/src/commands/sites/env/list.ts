import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable, maskSecret } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { readRemoteEnv } from "../api.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteOptionBuilder,
} from "../interactive.ts";

interface ListArgs extends SiteSelectorArgs {
  show?: boolean;
}

export const sitesEnvListCommand = defineCommand<ListArgs>({
  command: "list",
  aliases: ["ls"],
  describe: "List a site's build-time environment variables.",
  examples: [
    ["$0 sites env list", "List variables (values masked)"],
    ["$0 sites env list --show", "List with values revealed"],
  ],

  builder: (yargs) =>
    siteOptionBuilder(yargs).option("show", {
      type: "boolean",
      default: false,
      describe: "Reveal values instead of masking them",
    }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { site, offerLink } = await selectSite(client, {
      site: args.site,
      link: args.link,
      output,
    });

    const spin = spinner("Fetching variables...");
    spin.start();
    let env: Record<string, string>;
    try {
      env = await readRemoteEnv(site.connection);
    } finally {
      spin.stop();
    }

    const entries = Object.entries(env);
    const display = (value: string) => (args.show ? value : maskSecret(value));

    if (output === "json") {
      logger.log(
        JSON.stringify(
          Object.fromEntries(entries.map(([k, v]) => [k, display(v)])),
          null,
          2,
        ),
      );
      return;
    }

    if (entries.length === 0) {
      logger.info("No variables set.");
      logger.dim("  Set one with `bunny sites env set <name> <value>`.");
      await offerLink();
      return;
    }

    logger.log(
      formatTable(
        ["Name", "Value"],
        entries.map(([k, v]) => [k, display(v)]),
        output,
      ),
    );
    if (!args.show) {
      logger.dim("  Values are masked — pass --show to reveal them.");
    }

    await offerLink();
  },
});
