import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatKeyValue } from "../../core/format.ts";
import { normalizeHostname } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { saveManifest } from "../../core/manifest.ts";
import { isInteractive, spinner } from "../../core/ui.ts";
import { createSite, siteContextFromZone } from "./api.ts";
import {
  isValidSiteName,
  SITES_MANIFEST,
  type SiteManifest,
} from "./constants.ts";
import { setupSiteDomain } from "./domains/index.ts";

interface CreateArgs {
  name: string;
  region?: string;
  domain?: string;
  link?: boolean;
}

/**
 * Create a new static site: a storage zone (files), a pull zone (CDN), and a
 * middleware router script that maps hosts to deploy directories. The site's
 * state lives at `_bunny/site.json` inside the storage zone.
 */
export const sitesCreateCommand = defineCommand<CreateArgs>({
  command: "create <name>",
  describe: "Create a new static site.",
  examples: [
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
          "Site name — becomes the storage zone, pull zone, and <name>.b-cdn.net subdomain",
        demandOption: true,
      })
      .option("region", {
        type: "string",
        default: "DE",
        describe: "Main storage region code (e.g. DE, NY, LA, SG)",
      })
      .option("domain", {
        type: "string",
        describe: "Custom domain to attach (with *.preview.<domain> previews)",
      })
      .option("link", {
        type: "boolean",
        describe:
          "Link this directory to the new site (default: true). Use --no-link to skip.",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const name = args.name.toLowerCase();
    if (!isValidSiteName(name)) {
      throw new UserError(
        `"${args.name}" is not a valid site name.`,
        "Use 3–60 lowercase letters, digits, and dashes (no leading/trailing dash).",
      );
    }

    const domain = args.domain ? normalizeHostname(args.domain) : undefined;
    const interactive = isInteractive(output);

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

    // Attach the custom domain last — a domain failure mustn't fail the
    // create; the site already exists and can be retried via `sites domains add`.
    let domainError: string | undefined;
    if (domain) {
      const site = await siteContextFromZone(result.storageZone);
      if (site) {
        try {
          await setupSiteDomain({
            coreClient,
            site,
            domain,
            interactive,
            verbose,
            json: output === "json",
          });
        } catch (err) {
          domainError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    if (output === "json") {
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
    if (domainError) {
      logger.log();
      logger.warn(`Couldn't finish setting up ${domain}: ${domainError}`);
      logger.dim(`  Retry later: bunny sites domains add ${domain} ${name}`);
    }
    logger.log();
    logger.dim("  Deploy your site:  bunny sites deploy <dir>");
  },
});
