import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { readRemoteEnv, writeRemoteEnv } from "../api.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteOptionBuilder,
} from "../interactive.ts";

interface RemoveArgs extends SiteSelectorArgs {
  name: string;
  force?: boolean;
}

export const sitesEnvRemoveCommand = defineCommand<RemoveArgs>({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "Remove a build-time environment variable from a site.",
  examples: [
    ["$0 sites env remove VITE_API_URL", "Remove a variable"],
    ["$0 sites env remove VITE_API_URL --force", "Skip confirmation"],
  ],

  builder: (yargs) =>
    siteOptionBuilder(
      yargs.positional("name", {
        type: "string",
        describe: "Variable name to remove",
        demandOption: true,
      }),
    ).option("force", {
      alias: "f",
      type: "boolean",
      describe: "Skip the confirmation prompt",
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

    const env = await readRemoteEnv(site.connection);
    if (!(args.name in env)) {
      throw new UserError(
        `Variable "${args.name}" is not set for ${site.state.name}.`,
      );
    }

    const proceed = await confirm(`Remove ${args.name}?`, {
      force: args.force,
    });
    if (!proceed) {
      logger.log("Cancelled.");
      return;
    }

    const spin = spinner("Removing variable...");
    spin.start();
    try {
      delete env[args.name];
      await writeRemoteEnv(site.connection, env);
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { site: site.state.name, name: args.name, removed: true },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Removed ${args.name}.`);

    await offerLink();
  },
});
