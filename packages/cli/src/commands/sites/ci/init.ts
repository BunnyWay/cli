import { createCoreClient } from "@bunny.net/openapi-client";
import { loadSiteConfig } from "@/commands/sites/config.ts";
import { DEFAULT_KEEP_DEPLOYS } from "@/commands/sites/constants.ts";
import { resolveKeepCount } from "@/commands/sites/deployments/prune.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteLinkOption,
  siteOptionBuilder,
} from "@/commands/sites/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive } from "@/core/ui.ts";
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
  keep?: number;
  prune?: boolean;
}

// Scaffold `.github/workflows/bunny-sites.yml` via the BunnyWay/actions deploy-site action: pushes to main go live, and `workflow_dispatch` redeploys on demand.
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
    ["$0 sites ci init --keep 10", "Keep the 10 newest deploys after each run"],
    ["$0 sites ci init --no-prune", "Never prune deploys from the workflow"],
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
      })
      .option("keep", {
        type: "number",
        default: DEFAULT_KEEP_DEPLOYS,
        describe:
          "Deploys the workflow keeps after each run (live and previous are always kept)",
      })
      .option("prune", {
        type: "boolean",
        default: true,
        describe: "Prune old deploys after each run; --no-prune leaves them",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const interactive = isInteractive(output);
    const keep = args.prune === false ? false : resolveKeepCount(args.keep);

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

    // `sites.dir`/`sites.build` are what a local deploy uses, so the workflow follows them, relative to the bunny.jsonc directory they resolve against.
    const siteConfig = loadSiteConfig();
    const result = await scaffoldSitesWorkflow({
      site: name,
      root,
      projectRoot: siteConfig?.root,
      frameworkId: args.framework,
      interactive,
      force: args.force,
      dir: siteConfig?.config.dir,
      build: siteConfig?.config.build,
      keep,
    });

    if (output === "json") {
      logger.log(
        JSON.stringify(
          result && {
            site: name,
            path: result.path,
            framework: result.preset.id,
            packageManager: result.packageManager,
            directory: result.dir,
            keep: keep === false ? null : keep,
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
      `Wrote ${result.path} (${result.preset.label}, deploys ${result.dir}).`,
    );
    if (keep !== false) {
      logger.dim(
        `  Each run prunes old deploys, keeping the newest ${keep}; change with --keep or --no-prune.`,
      );
    }
    logger.log();
    await offerGitHubSecret({ apiKey: config.apiKey, root, interactive });
    logger.log();
    logger.dim("  Push to main on GitHub and the site goes live.");

    await offerLink();
  },
});
