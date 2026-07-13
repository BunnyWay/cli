import { basename } from "node:path";
import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatKeyValue } from "../../core/format.ts";
import { normalizeHostname } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { confirm, isInteractive, spinner } from "../../core/ui.ts";
import { createSite, siteContextFromZone } from "./api.ts";
import {
  gitTopLevel,
  hasGitHubOrigin,
  offerGitHubSecret,
  printWorkflowInstructions,
  scaffoldSitesWorkflow,
} from "./ci/scaffold.ts";
import {
  isValidSiteName,
  SITES_MANIFEST,
  type SiteManifest,
} from "./constants.ts";
import { setupSiteDomain } from "./domains/index.ts";

interface CreateArgs {
  name?: string;
  region?: string;
  domain?: string;
  link?: boolean;
}

const SITE_NAME_RULES =
  "Use 3–60 lowercase letters, digits, and dashes (no leading/trailing dash).";

function suggestSiteName(): string | undefined {
  const base = basename(process.cwd())
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return isValidSiteName(base) ? base : undefined;
}

/**
 * Create a new static site: a storage zone (files), a pull zone (CDN), and a
 * middleware router script that maps hosts to deploy directories. The site's
 * state lives at `_bunny/site.json` inside the storage zone.
 */
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
          "Site name — becomes the storage zone, pull zone, and <name>.b-cdn.net subdomain (prompted when omitted)",
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

    let name = args.name?.trim().toLowerCase();
    if (!name && interactive) {
      const suggestion = suggestSiteName();
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Site name:",
        ...(suggestion ? { initial: suggestion } : {}),
        validate: (v: string) =>
          isValidSiteName(String(v).trim().toLowerCase()) || SITE_NAME_RULES,
      });
      name = (value as string | undefined)?.trim().toLowerCase();
    }
    if (!name) {
      throw new UserError(
        "Site name is required.",
        "Pass one: bunny sites create <name>.",
      );
    }
    if (!isValidSiteName(name)) {
      throw new UserError(
        `"${args.name ?? name}" is not a valid site name.`,
        SITE_NAME_RULES,
      );
    }

    const domain = args.domain ? normalizeHostname(args.domain) : undefined;

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    const spin = spinner(`Creating site "${name}"...`);
    spin.start();
    let result: Awaited<ReturnType<typeof createSite>>;
    try {
      result = await createSite({
        coreClient,
        computeClient,
        name,
        region: (args.region ?? "DE").toUpperCase(),
        onStep: (message) => {
          spin.text = message;
        },
      });
    } finally {
      spin.stop();
    }

    if (args.link !== false) {
      saveManifest<SiteManifest>(SITES_MANIFEST, {
        id: result.state.storageZoneId,
        name,
      });
    }

    if (output === "json") {
      // --domain is attached non-interactively; a failure still reports the created site.
      let domainError: string | undefined;
      if (domain) {
        const site = await siteContextFromZone(result.storageZone);
        if (site) {
          try {
            await setupSiteDomain({
              coreClient,
              site,
              domain,
              interactive: false,
              verbose,
              json: true,
            });
          } catch (err) {
            domainError = err instanceof Error ? err.message : String(err);
          }
        }
      }
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
      if (domainError) process.exit(1);
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
      // A domain failure mustn't fail the create; the site already exists
      // and the domain can be retried via `sites domains add`.
      logger.log();
      const site = await siteContextFromZone(result.storageZone);
      if (site) {
        try {
          await setupSiteDomain({
            coreClient,
            site,
            domain: chosenDomain,
            interactive,
            verbose,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`Couldn't finish setting up ${chosenDomain}: ${message}`);
          logger.dim(
            `  Retry later: bunny sites domains add ${chosenDomain} ${name}`,
          );
        }
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
          const result = await scaffoldSitesWorkflow({
            site: name,
            root,
            interactive: true,
          });
          if (result) {
            logger.success(
              `Wrote ${result.path} (${result.preset.label}, deploys ${result.preset.dir}).`,
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
