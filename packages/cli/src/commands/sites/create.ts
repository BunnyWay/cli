import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { errorMessage } from "../../core/errors.ts";
import { formatKeyValue } from "../../core/format.ts";
import { normalizeHostname } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { confirm, isInteractive, prompts } from "../../core/ui.ts";
import type { CoreClient, StorageZoneModel } from "../storage/api.ts";
import {
  ZONE_TIER_CHOICES,
  type ZoneTierChoice,
  zoneTierChoice,
  zoneTierLabel,
} from "../storage/constants.ts";
import { siteContextFromZone } from "./api.ts";
import {
  gitTopLevel,
  hasGitHubOrigin,
  offerGitHubSecret,
  printWorkflowInstructions,
  scaffoldSitesWorkflow,
} from "./ci/scaffold.ts";
import { loadSiteConfig } from "./config.ts";
import { SITES_MANIFEST, type SiteManifest } from "./constants.ts";
import { setupSiteDomain } from "./domains/index.ts";
import { createSiteWithProgress, promptSiteName } from "./provision.ts";

interface CreateArgs {
  name?: string;
  region?: string;
  tier?: ZoneTierChoice;
  domain?: string;
  link?: boolean;
}

// Attach a custom production domain to a just-created site; never throws (the site already exists and the domain can be retried via `sites domains add`).
async function attachDomainToCreatedSite(opts: {
  coreClient: CoreClient;
  storageZone: StorageZoneModel;
  domain: string;
  interactive: boolean;
  verbose: boolean;
  json?: boolean;
}): Promise<{ error?: string }> {
  const site = await siteContextFromZone(opts.storageZone);
  if (!site) return {};
  try {
    await setupSiteDomain({
      coreClient: opts.coreClient,
      site,
      domain: opts.domain,
      interactive: opts.interactive,
      verbose: opts.verbose,
      json: opts.json,
    });
    return {};
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// Create a static site: a storage zone (files), a pull zone (CDN), and a middleware router script mapping hosts to deploy dirs; state lives at `_bunny/site.json` in the storage zone.
export const sitesCreateCommand = defineCommand<CreateArgs>({
  command: "create [name]",
  describe: "Create a new static site.",
  examples: [
    [
      "$0 sites create",
      "Use `sites.name` from bunny.jsonc, else prompt (directory-name suggestion)",
    ],
    [
      "$0 sites create my-site",
      "Create a site served at sites-my-site-<suffix>.b-cdn.net",
    ],
    [
      "$0 sites create my-site --domain example.com",
      "Create and attach a custom domain",
    ],
    ["$0 sites create my-site --region NY", "Store files in New York"],
    [
      "$0 sites create my-site --tier ssd",
      "Store files on the Edge (SSD) tier (always DE)",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe:
          "Site name; the storage zone, pull zone, and b-cdn.net subdomain become sites-<name>-xxxxxx (defaults to `sites.name` in bunny.jsonc, else prompted)",
      })
      .option("region", {
        type: "string",
        default: "DE",
        describe: "Main storage region code (e.g. DE, NY, LA, SG)",
      })
      .option("tier", {
        type: "string",
        choices: ZONE_TIER_CHOICES,
        describe:
          "Storage tier for the site's files: hdd (Standard) or ssd (Edge, always DE)",
      })
      .option("domain", {
        type: "string",
        describe:
          "Custom production domain to attach (offered interactively when omitted)",
      })
      .option("link", {
        type: "boolean",
        describe:
          "Link this directory to the new site (default: true). Use --no-link to skip.",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const interactive = isInteractive(output);

    // `sites.name` is how every other sites command resolves the site, so create takes it as the name too.
    const loadedConfig = loadSiteConfig();
    const siteConfig = loadedConfig?.config;
    const configRoot = loadedConfig?.root;
    const name = await promptSiteName(
      args.name ?? siteConfig?.name,
      interactive,
    );
    if (!args.name && siteConfig?.name && output !== "json") {
      logger.info(`Using site name "${name}" from bunny.jsonc.`);
    }

    const domain = args.domain ? normalizeHostname(args.domain) : undefined;

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    const result = await createSiteWithProgress({
      coreClient,
      computeClient,
      name,
      region: args.region,
      tier: args.tier,
    });

    if (args.link !== false) {
      saveManifest<SiteManifest>(SITES_MANIFEST, {
        id: result.state.storageZoneId,
        name,
      });
    }

    if (output === "json") {
      // --domain is attached non-interactively; a failure is reported but doesn't fail the create.
      const attach = domain
        ? await attachDomainToCreatedSite({
            coreClient,
            storageZone: result.storageZone,
            domain,
            interactive: false,
            verbose,
            json: true,
          })
        : undefined;
      const domainError = attach?.error;
      logger.log(
        JSON.stringify(
          {
            name,
            storageZoneId: result.state.storageZoneId,
            pullZoneId: result.state.pullZoneId,
            scriptId: result.state.scriptId,
            hostname: result.systemHostname ?? null,
            tier: zoneTierChoice(result.storageZone),
            domain: domain ?? null,
            linked: args.link !== false,
            ...(domainError ? { domainError } : {}),
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Created site "${name}".`);
    logger.log();
    logger.log(
      formatKeyValue(
        [
          { key: "Site", value: name },
          { key: "Storage zone", value: String(result.state.storageZoneId) },
          {
            key: "Storage tier",
            value: zoneTierLabel(result.storageZone, "long"),
          },
          { key: "Pull zone", value: String(result.state.pullZoneId) },
          { key: "Router script", value: String(result.state.scriptId) },
          ...(result.systemHostname
            ? [{ key: "URL", value: `https://${result.systemHostname}` }]
            : []),
        ],
        output,
      ),
    );

    // Custom domain: --domain flag, or offer one interactively (mirrors `scripts create`).
    let chosenDomain = domain;
    if (!chosenDomain && interactive) {
      logger.log();
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Custom domain (leave blank to skip):",
      });
      chosenDomain = normalizeHostname(value ?? "") || undefined;
    }
    if (chosenDomain) {
      logger.log();
      const { error: domainError } = await attachDomainToCreatedSite({
        coreClient,
        storageZone: result.storageZone,
        domain: chosenDomain,
        interactive,
        verbose,
      });
      if (domainError) {
        logger.warn(
          `Couldn't finish setting up ${chosenDomain}: ${domainError}`,
        );
        logger.dim(
          `  Retry later: bunny sites domains add ${chosenDomain} ${name}`,
        );
      }
    }

    // GitHub deployments: offer the workflow scaffold when this is a GitHub repo.
    if (interactive) {
      const root = await gitTopLevel(process.cwd());
      if (root && (await hasGitHubOrigin(root))) {
        logger.log();
        const setup = await confirm(
          "Set up GitHub deployments (push to main goes live)?",
          { initial: true, optional: true },
        );
        if (setup) {
          const scaffold = await scaffoldSitesWorkflow({
            site: name,
            root,
            projectRoot: configRoot,
            interactive: true,
            dir: siteConfig?.dir,
            build: siteConfig?.build,
          });
          if (scaffold) {
            logger.success(
              `Wrote ${scaffold.path} (${scaffold.preset.label}, deploys ${scaffold.dir}).`,
            );
            await offerGitHubSecret({
              apiKey: config.apiKey,
              root,
              interactive,
            });
          }
        } else {
          await printWorkflowInstructions(name, root, {
            root: configRoot,
            ...siteConfig,
          });
        }
      }
    }

    logger.log();
    logger.dim("  Deploy your site:  bunny sites deploy <dir>");
  },
});
