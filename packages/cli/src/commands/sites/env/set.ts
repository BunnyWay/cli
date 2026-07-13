import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { readRemoteEnv, writeRemoteEnv } from "../api.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteOptionBuilder,
} from "../interactive.ts";

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface SetArgs extends SiteSelectorArgs {
  name?: string;
  value?: string;
}

/**
 * Set a build-time variable for a site (stored at `_bunny/env.json`, which
 * the router 403-blocks). These are merged into the environment of
 * `sites deploy --build` — they are NOT runtime env and NOT a secret store:
 * anything the build reads can end up in the shipped bundle.
 */
export const sitesEnvSetCommand = defineCommand<SetArgs>({
  command: "set [name] [value]",
  describe: "Set a build-time environment variable for a site.",
  examples: [
    [
      '$0 sites env set VITE_API_URL "https://api.example.com"',
      "Set a variable",
    ],
    ["$0 sites env set", "Interactive mode"],
  ],

  builder: (yargs) =>
    siteOptionBuilder(
      yargs
        .positional("name", { type: "string", describe: "Variable name" })
        .positional("value", { type: "string", describe: "Variable value" }),
    ),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { site, offerLink } = await selectSite(client, {
      site: args.site,
      link: args.link,
      output,
    });

    let name = args.name;
    if (!name) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Variable name:",
      });
      name = value;
    }
    if (!name) throw new UserError("Variable name is required.");
    if (!ENV_NAME_RE.test(name)) {
      throw new UserError(
        `"${name}" is not a valid environment variable name.`,
        "Names must start with a letter or underscore and contain only letters, digits, and underscores.",
      );
    }

    let value = args.value;
    if (value === undefined) {
      const { value: prompted } = await prompts({
        type: "text",
        name: "value",
        message: "Variable value:",
      });
      value = prompted;
    }
    if (value === undefined) throw new UserError("Variable value is required.");

    const spin = spinner("Saving variable...");
    spin.start();
    try {
      const env = await readRemoteEnv(site.connection);
      env[name] = value;
      await writeRemoteEnv(site.connection, env);
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify({ site: site.state.name, name }, null, 2));
      return;
    }

    logger.success(`Set ${name} for ${site.state.name}.`);
    logger.warn(
      "Build-time env is baked into the deployed bundle — don't store runtime secrets here.",
    );

    await offerLink();
  },
});
