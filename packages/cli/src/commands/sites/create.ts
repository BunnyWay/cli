import { createCoreClient } from "@bunny.net/openapi-client";
import { type CoreClient, resolveStorageZone } from "@/commands/storage/api.ts";
import {
  ZONE_TIER_CHOICES,
  type ZoneTierChoice,
  zoneTierChoice,
  zoneTierLabel,
} from "@/commands/storage/constants.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { errorMessage, UserError } from "@/core/errors.ts";
import { formatKeyValue } from "@/core/format.ts";
import { normalizeHostname } from "@/core/hostnames/index.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import {
  confirm,
  isInteractive,
  prompts,
  requireConfirmable,
  withSpinner,
} from "@/core/ui.ts";
import { importSite, planSiteImport, type SiteContext } from "./api.ts";
import {
  gitTopLevel,
  hasGitHubOrigin,
  offerGitHubSecret,
  printWorkflowInstructions,
  scaffoldSitesWorkflow,
} from "./ci/scaffold.ts";
import { loadSiteConfig } from "./config.ts";
import { isValidSiteName } from "./constants.ts";
import { setupSiteDomain } from "./domains/index.ts";
import { saveSiteLink } from "./interactive.ts";
import { createSiteWithProgress, promptSiteName } from "./provision.ts";

interface CreateArgs {
  name?: string;
  region?: string;
  tier?: ZoneTierChoice;
  domain?: string;
  link?: boolean;
  "from-zone"?: string;
  force?: boolean;
}

// Attach a custom production domain to a just-created site; never throws (the site already exists and the domain can be retried via `sites domains add`).
async function attachDomainToCreatedSite(opts: {
  coreClient: CoreClient;
  site: SiteContext;
  domain: string;
  interactive: boolean;
  verbose: boolean;
  json?: boolean;
}): Promise<{ error?: string }> {
  try {
    await setupSiteDomain({
      coreClient: opts.coreClient,
      site: opts.site,
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

// Adopt an existing storage zone and its pull zone as a site, keeping its hostnames; nothing it serves changes until the first deploy.
async function importExistingZone(opts: {
  coreClient: CoreClient;
  args: CreateArgs & { output: OutputFormat };
  siteName?: string;
}): Promise<void> {
  const { coreClient, args } = opts;
  const { output } = args;
  const interactive = isInteractive(output);
  if (args.region || args.tier || args.domain) {
    throw new UserError(
      "--region, --tier and --domain don't apply to --from-zone.",
      "The zone keeps its region, tier and hostnames; add another domain later with `bunny sites domains add`.",
    );
  }

  const storageZone = await resolveStorageZone(
    coreClient,
    args["from-zone"] as string,
  );
  const zoneName = (storageZone.Name ?? "").toLowerCase();
  const name = await promptSiteName(
    opts.siteName ?? (isValidSiteName(zoneName) ? zoneName : undefined),
    interactive,
    "Pass one: bunny sites create <name> --from-zone <zone>.",
  );

  const plan = await withSpinner("Checking storage zone...", () =>
    planSiteImport({
      coreClient,
      storageZone,
      name,
    }),
  );
  const hostnames = (plan.pullZone.Hostnames ?? [])
    .map((h) => h.Value)
    .filter((v): v is string => !!v);

  requireConfirmable(output, {
    force: args.force,
    message: "Importing a storage zone needs a confirmation prompt.",
    hint: "Pass --force to import without prompting.",
  });
  if (output !== "json") {
    logger.log(
      `Import storage zone "${storageZone.Name}" (${storageZone.Id}) as site "${name}":`,
    );
    logger.log();
    logger.log(
      formatKeyValue(
        [
          { key: "Pull zone", value: String(plan.pullZone.Id) },
          { key: "Hostnames", value: hostnames.join(", ") || "-" },
          {
            key: "Root entries",
            value: `${plan.rootEntries} (served until the first deploy, then kept in storage unserved)`,
          },
          ...(plan.foreignRules > 0
            ? [
                {
                  key: "Other edge rules",
                  value: `${plan.foreignRules} (left in place; check they don't conflict)`,
                },
              ]
            : []),
        ],
        output,
      ),
    );
    logger.log();
    logger.dim(
      "  Nothing changes for visitors until the first deploy, which switches the pull zone to sites routing and caching (30-day edge cache, browsers revalidate HTML).",
    );
    logger.log();
  }
  const confirmed = await confirm("Import it?", {
    force: args.force,
    initial: true,
  });
  if (!confirmed) {
    logger.log("Import cancelled.");
    return;
  }

  const state = await withSpinner("Importing...", () =>
    importSite({ coreClient, plan, name }),
  );
  if (args.link !== false) {
    saveSiteLink(state);
  }

  if (output === "json") {
    logger.log(
      JSON.stringify(
        {
          name,
          storageZoneId: state.storageZoneId,
          pullZoneId: state.pullZoneId,
          hostnames,
          imported: true,
          linked: args.link !== false,
        },
        null,
        2,
      ),
    );
    return;
  }
  logger.success(`Imported "${storageZone.Name}" as site "${name}".`);
  logger.log();
  logger.dim("  Go live on the existing hostnames:  bunny sites deploy <dir>");
  logger.dim("  Deploy from GitHub Actions:         bunny sites ci init");
}

// Create a static site: a storage zone (files) and a pull zone (CDN) whose edge rules serve the published deploy dir; state lives at `_bunny/site.json` in the storage zone.
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
    [
      "$0 sites create my-site --from-zone my-zone",
      "Import an existing storage zone and its pull zone, keeping its hostnames",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe:
          "Site name; the storage zone, pull zone, and b-cdn.net subdomain become sites-<name>-xxxxxx (defaults to `sites.name` in bunny.jsonc, else prompted)",
      })
      // No parser default: an omitted --region must stay undefined so resuming a half-created zone in another region isn't rejected as a mismatch.
      .option("region", {
        type: "string",
        describe: "Main storage region code (e.g. DE, NY, LA, SG; default DE)",
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
      })
      .option("from-zone", {
        type: "string",
        describe:
          "Import an existing storage zone (name or ID) and its pull zone instead of creating new ones",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "With --from-zone: import without the confirmation prompt",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const interactive = isInteractive(output);

    // `sites.name` is how every other sites command resolves the site, so create takes it as the name too.
    const loadedConfig = loadSiteConfig();
    const siteConfig = loadedConfig?.config;
    const configRoot = loadedConfig?.root;

    if (args["from-zone"]) {
      const config = resolveConfig(profile, apiKey, verbose);
      await importExistingZone({
        coreClient: createCoreClient(clientOptions(config, verbose)),
        args,
        siteName: args.name ?? siteConfig?.name,
      });
      return;
    }
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

    const result = await createSiteWithProgress({
      coreClient,
      name,
      region: args.region,
      tier: args.tier,
    });

    if (args.link !== false) {
      saveSiteLink(result.state);
    }

    if (output === "json") {
      // --domain is attached non-interactively; a failure is reported but doesn't fail the create.
      const attach = domain
        ? await attachDomainToCreatedSite({
            coreClient,
            site: result,
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
        site: result,
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
