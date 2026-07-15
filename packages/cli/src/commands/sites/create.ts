import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatKeyValue } from "../../core/format.ts";
import { normalizeHostname } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { confirm, isInteractive, withSpinner } from "../../core/ui.ts";
import type { CoreClient, StorageZoneModel } from "../storage/api.ts";
import { createSite, siteContextFromZone } from "./api.ts";
import {
  gitTopLevel,
  hasGitHubOrigin,
  offerGitHubSecret,
  printWorkflowInstructions,
  scaffoldSitesWorkflow,
} from "./ci/scaffold.ts";
import { SITES_MANIFEST, type SiteManifest } from "./constants.ts";
import { setupSiteDomain } from "./domains/index.ts";
import { promptSiteName } from "./provision.ts";

interface CreateArgs {
  name?: string;
  region?: string;
  domain?: string;
  link?: boolean;
}

// Attach a custom domain to a just-created site; returns an error message on failure (never throws).
async function attachDomainToCreatedSite(opts: {
  coreClient: CoreClient;
  storageZone: StorageZoneModel;
  domain: string;
  interactive: boolean;
  verbose: boolean;
  json?: boolean;
}): Promise<string | undefined> {
  const site = await siteContextFromZone(opts.storageZone);
  if (!site) return undefined;
  try {
    await setupSiteDomain({
      coreClient: opts.coreClient,
      site,
      domain: opts.domain,
      interactive: opts.interactive,
      verbose: opts.verbose,
      json: opts.json,
    });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// Create a static site: a storage zone (files), a pull zone (CDN), and a middleware router script mapping hosts to deploy dirs; state lives at `_bunny/site.json` in the storage zone.
export const sitesCreateCommand = defineCommand<CreateArgs>({
  command: "create [name]",
  describe: "Create a new static site.",
  examples: [
    ["$0 sites create", "Prompt for a name (defaults to the directory name)"],
    ["$0 sites create my-site", "Create a site served at my-site.b-cdn.net"],
    [
      "$0 sites create my-site --domain example.com",
      "Create and attach a custom domain",
    ],
    ["$0 sites create my-site --region NY", "Store files in New York"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe:
          "Site name; becomes the storage zone, pull zone, and <name>.b-cdn.net subdomain (prompted when omitted)",
      })
      .option("region", {
        type: "string",
        default: "DE",
        describe: "Main storage region code (e.g. DE, NY, LA, SG)",
      })
      .option("domain", {
        type: "string",
        describe:
          "Custom domain to attach, with *.preview.<domain> previews (offered interactively when omitted)",
      })
      .option("link", {
        type: "boolean",
        describe:
          "Link this directory to the new site (default: true). Use --no-link to skip.",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const interactive = isInteractive(output);

    const name = await promptSiteName(args.name, interactive);

    const domain = args.domain ? normalizeHostname(args.domain) : undefined;

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    const result = await withSpinner(`Creating site "${name}"...`, (spin) =>
      createSite({
        coreClient,
        computeClient,
        name,
        region: (args.region ?? "DE").toUpperCase(),
        onStep: (message) => {
          spin.text = message;
        },
      }),
    );

    if (args.link !== false) {
      saveManifest<SiteManifest>(SITES_MANIFEST, {
        id: result.state.storageZoneId,
        name,
      });
    }

    if (output === "json") {
      // --domain is attached non-interactively; a failure is reported but doesn't fail the create.
      const domainError = domain
        ? await attachDomainToCreatedSite({
            coreClient,
            storageZone: result.storageZone,
            domain,
            interactive: false,
            verbose,
            json: true,
          })
        : undefined;
      logger.log(
        JSON.stringify(
          {
            name,
            storageZoneId: result.state.storageZoneId,
            pullZoneId: result.state.pullZoneId,
            scriptId: result.state.scriptId,
            hostname: result.systemHostname ?? null,
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
      // A domain failure mustn't fail the create; the site already exists and the domain can be retried via `sites domains add`.
      logger.log();
      const domainError = await attachDomainToCreatedSite({
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
          "Set up GitHub deployments (preview on PRs, production on main)?",
          { initial: true },
        );
        if (setup) {
          const scaffold = await scaffoldSitesWorkflow({
            site: name,
            root,
            interactive: true,
          });
          if (scaffold) {
            logger.success(
              `Wrote ${scaffold.path} (${scaffold.preset.label}, deploys ${scaffold.preset.dir}).`,
            );
            await offerGitHubSecret({
              apiKey: config.apiKey,
              root,
              interactive,
            });
          }
        } else {
          await printWorkflowInstructions(name, root);
        }
      }
    }

    logger.log();
    logger.dim("  Deploy your site:  bunny sites deploy <dir>");
  },
});
