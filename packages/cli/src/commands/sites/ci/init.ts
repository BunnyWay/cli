import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { isInteractive } from "../../../core/ui.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteLinkOption,
  siteOptionBuilder,
} from "../interactive.ts";
import { FRAMEWORK_PRESETS } from "./frameworks.ts";
import {
  gitTopLevel,
  hasGitHubOrigin,
  offerGitHubSecret,
  scaffoldSitesWorkflow,
} from "./scaffold.ts";

interface CiInitArgs extends SiteSelectorArgs {
  framework?: string;
  force?: boolean;
}

// Scaffold `.github/workflows/bunny-sites.yml`: previews on PRs, production on merges to main, via the BunnyWay/actions deploy-site action.
export const sitesCiInitCommand = defineCommand<CiInitArgs>({
  command: "init",
  describe: "Add a GitHub Actions workflow that deploys this site.",
  examples: [
    ["$0 sites ci init", "Detect the framework and write the workflow"],
    ["$0 sites ci init --framework astro", "Skip detection"],
    [
      "$0 sites ci init --site my-site --force",
      "Overwrite an existing workflow",
    ],
  ],

  builder: (yargs) =>
    siteLinkOption(siteOptionBuilder(yargs))
      .option("framework", {
        type: "string",
        choices: FRAMEWORK_PRESETS.map((p) => p.id),
        describe: "Framework preset for the build steps (default: detected)",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Overwrite an existing workflow file",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const interactive = isInteractive(output);

    const config = resolveConfig(profile, apiKey, verbose);
    const coreClient = createCoreClient(clientOptions(config, verbose));
    const { site, offerLink } = await selectSite(coreClient, {
      site: args.site,
      link: args.link,
      output,
    });
    const name = site.state.name;

    const root = (await gitTopLevel(process.cwd())) ?? process.cwd();
    if (output !== "json" && !(await hasGitHubOrigin(root))) {
      logger.dim(
        "  No GitHub origin remote detected; writing the workflow anyway.",
      );
    }

    const result = await scaffoldSitesWorkflow({
      site: name,
      root,
      frameworkId: args.framework,
      interactive,
      force: args.force,
    });

    if (output === "json") {
      logger.log(
        JSON.stringify(
          result && {
            site: name,
            path: result.path,
            framework: result.preset.id,
            packageManager: result.packageManager,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!result) {
      logger.log("Cancelled.");
      return;
    }

    logger.success(
      `Wrote ${result.path} (${result.preset.label}, deploys ${result.preset.dir}).`,
    );
    logger.log();
    await offerGitHubSecret({ apiKey: config.apiKey, root, interactive });
    logger.log();
    logger.dim(
      "  Push to GitHub: PRs get preview URLs, merges to main go live.",
    );

    await offerLink();
  },
});
