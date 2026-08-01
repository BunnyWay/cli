import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { isInteractive } from "../../../core/ui.ts";
import {
  fetchSiteHostnames,
  persistReconciledDomain,
  reconcilePreviewDomain,
} from "../api.ts";
import { loadSiteConfig } from "../config.ts";
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

// Scaffold `.github/workflows/bunny-sites.yml` via the BunnyWay/actions deploy-site action: with a custom domain, previews on PRs + production on merges to main; without one, production on merges to main only.
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

    // PR previews must key off the same signal deploy uses: the zone's wildcard, since a failed state write can leave `state.domain` unset while previews work fine.
    const zone = await fetchSiteHostnames(coreClient, site.state.pullZoneId);
    if (reconcilePreviewDomain(site.state, zone)) {
      await persistReconciledDomain(site);
    }
    const previews = Boolean(site.state.domain);

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
      previews,
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
    logger.log();
    await offerGitHubSecret({ apiKey: config.apiKey, root, interactive });
    logger.log();
    if (previews) {
      logger.dim(
        "  Push to GitHub: PRs get preview URLs, merges to main go live.",
      );
    } else {
      logger.dim("  Push to GitHub: merges to main deploy the live site.");
      logger.dim(
        "  Add a custom domain (`bunny sites domains add`), then re-run `bunny sites ci init --force` for PR previews.",
      );
    }

    await offerLink();
  },
});
