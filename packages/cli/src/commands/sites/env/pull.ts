import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { readRemoteEnv } from "../api.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteOptionBuilder,
} from "../interactive.ts";

interface PullArgs extends SiteSelectorArgs {
  file?: string;
  force?: boolean;
}

/** Serialize env pairs as dotenv lines, quoting anything that needs it. */
export function toDotenv(env: Record<string, string>): string {
  return `${Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) =>
      /^[A-Za-z0-9_./:@-]*$/.test(value)
        ? `${key}=${value}`
        : `${key}=${JSON.stringify(value)}`,
    )
    .join("\n")}\n`;
}

export const sitesEnvPullCommand = defineCommand<PullArgs>({
  command: "pull [file]",
  describe: "Write a site's build-time env to a local dotenv file.",
  examples: [
    ["$0 sites env pull", "Write to .env (refuses to overwrite)"],
    ["$0 sites env pull .env.local --force", "Overwrite a specific file"],
  ],

  builder: (yargs) =>
    siteOptionBuilder(
      yargs.positional("file", {
        type: "string",
        describe: "Output file (default: .env)",
      }),
    ).option("force", {
      alias: "f",
      type: "boolean",
      describe: "Overwrite the file if it exists",
    }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const target = resolve(args.file ?? ".env");
    if (existsSync(target) && !args.force) {
      throw new UserError(
        `${target} already exists.`,
        "Pass --force to overwrite it.",
      );
    }

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

    await Bun.write(target, toDotenv(env), { mode: 0o600 });

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            site: site.state.name,
            file: target,
            variables: Object.keys(env).length,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(
      `Wrote ${Object.keys(env).length} variable(s) to ${target}.`,
    );

    await offerLink();
  },
});
