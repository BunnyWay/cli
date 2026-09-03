// TODO: Remove this in the next major release

import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest } from "../../core/manifest.ts";
import {
  confirm,
  isInteractive,
  prompts,
  requireConfirmable,
  withSpinner,
} from "../../core/ui.ts";
import {
  type CoreClient,
  fetchStorageZone,
  resolveStorageZone,
  type StorageZoneModel,
} from "../storage/api.ts";
import type { StorageZone } from "../storage/files-api.ts";
import {
  classifySiteZone,
  fetchLegacySites,
  fetchSystemHostname,
  type MigrateResult,
  migrateSite,
  siteFiles,
} from "./api.ts";
import { loadSiteConfig } from "./config.ts";
import {
  type LegacySiteState,
  SITES_MANIFEST,
  type SiteManifest,
} from "./constants.ts";
import { productionUrl } from "./deploy.ts";
import { sitePositionalBuilder } from "./interactive.ts";

interface MigrateArgs {
  site?: string;
  force?: boolean;
  "dry-run"?: boolean;
  "keep-script"?: boolean;
}

interface LegacySite {
  state: LegacySiteState;
  storageZone: StorageZoneModel;
  connection: StorageZone;
}

function legacySite(
  state: LegacySiteState,
  storageZone: StorageZoneModel,
): LegacySite {
  return { state, storageZone, connection: siteFiles.connect(storageZone) };
}

function alreadyMigrated(name: string): UserError {
  return new UserError(
    `Site "${name}" is already on the edge-rule architecture.`,
    "Deploy it as usual with `bunny sites deploy`.",
  );
}

async function legacySiteFromRef(
  client: CoreClient,
  ref: string,
): Promise<LegacySite> {
  let zone: StorageZoneModel | undefined;
  try {
    zone = await resolveStorageZone(client, ref);
  } catch {
    zone = undefined;
  }
  if (zone) {
    const state = await classifySiteZone(zone);
    if (state.kind === "legacy") return legacySite(state.state, zone);
    if (state.kind === "current") throw alreadyMigrated(state.state.name);
  }

  const matches = (await fetchLegacySites(client)).filter(
    (s) => s.state.name.toLowerCase() === ref.toLowerCase(),
  );
  if (matches.length > 1) {
    throw new UserError(
      `Multiple router-era sites are named "${ref}".`,
      "Pass the storage zone ID instead.",
    );
  }
  const match = matches[0];
  if (match) return legacySite(match.state, match.storageZone);

  if (zone) {
    throw new UserError(
      `Storage zone "${zone.Name}" is not a router-era site.`,
      "Only sites created before edge rules replaced the router script need migrating.",
    );
  }
  throw new UserError(
    `No router-era site found for "${ref}".`,
    "Run `bunny sites migrate` with no arguments to pick from the ones this account has.",
  );
}

// Pick the site to migrate, walking the same precedence as `selectSite`: explicit ref, `.bunny/site.json`, `sites.name` in bunny.jsonc, then a picker over the account scan. Discovery is separate because a router-era site's state no longer parses, so `selectSite` can't see it at all.
async function selectLegacySite(
  client: CoreClient,
  args: { site?: string; output: string; force?: boolean },
): Promise<LegacySite> {
  if (args.site) {
    const ref = args.site;
    return withSpinner("Resolving site...", () =>
      legacySiteFromRef(client, ref),
    );
  }

  const manifest = loadManifest<SiteManifest>(SITES_MANIFEST);
  if (manifest.id) {
    const id = manifest.id;
    const linked = await withSpinner("Loading linked site...", async () => {
      const zone = await fetchStorageZone(client, id);
      return { zone, state: await classifySiteZone(zone) };
    });
    if (linked.state.kind === "current") {
      throw alreadyMigrated(linked.state.state.name);
    }
    if (linked.state.kind === "none") {
      throw new UserError(
        `The linked storage zone ${id} is not a site.`,
        "Run `bunny sites unlink`, then link or create a site.",
      );
    }
    return legacySite(linked.state.state, linked.zone);
  }

  const configured = loadSiteConfig()?.config.name;
  if (configured) {
    return withSpinner(
      `Resolving site "${configured}" from bunny.jsonc...`,
      () => legacySiteFromRef(client, configured),
    );
  }

  const sites = await withSpinner("Scanning for router-era sites...", () =>
    fetchLegacySites(client),
  );
  if (sites.length === 0) {
    throw new UserError(
      "No router-era sites found in your account.",
      "Nothing to migrate; sites on the current architecture deploy with `bunny sites deploy`.",
    );
  }

  if (args.force || !isInteractive(args.output)) {
    throw new UserError(
      "No site specified.",
      `Pass one: ${sites.map((s) => s.state.name).join(", ")}.`,
    );
  }

  const { selected } = await prompts({
    type: "select",
    name: "selected",
    message: "Migrate which site?",
    choices: sites.map((s) => ({
      title: `${s.state.name} (${s.state.storageZoneId})`,
      value: s,
    })),
  });
  if (!selected) throw new UserError("A site is required.");
  const summary = selected as (typeof sites)[number];
  return legacySite(summary.state, summary.storageZone);
}

function reportText(
  state: LegacySiteState,
  result: MigrateResult,
  production?: string,
): void {
  logger.success(`Migrated "${state.name}" to the edge-rule architecture.`);
  if (result.detachedScriptId != null) {
    logger.dim(`  Detached edge script ${result.detachedScriptId}.`);
  }
  if (result.scriptDeleted) {
    logger.dim(`  Deleted edge script ${state.scriptId}.`);
  } else if (result.scriptError) {
    logger.warn(
      `Couldn't delete edge script ${state.scriptId}: ${result.scriptError}`,
    );
    logger.dim("  Delete it by hand; the site no longer uses it.");
  }
  if (result.state.current) {
    logger.dim(`  Serving deploy ${result.state.current}.`);

    if (production) logger.info(`Production: ${production}`);
  } else {
    logger.info("The site has no published deploy; run `bunny sites deploy`.");
  }

  logger.warn(
    "Edge rules don't redirect `/path` to `/path/` the way the router did.",
  );
  logger.dim(
    "  Directory URLs ending in a slash still work; check any link to an extensionless path.",
  );
}

export const sitesMigrateCommand = defineCommand<MigrateArgs>({
  command: "migrate [site]",
  describe: "Migrate a router-era site to the edge-rule architecture.",
  hidden: true,

  builder: (yargs) =>
    sitePositionalBuilder(yargs)
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompts",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "Report what would change without touching the site",
      })
      .option("keep-script", {
        type: "boolean",
        default: false,
        describe: "Detach the router script but don't delete it",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey, force } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    const site = await selectLegacySite(coreClient, {
      site: args.site,
      output,
      force,
    });
    const { state } = site;

    if (args["dry-run"]) {
      const actions = [
        `Detach edge script ${state.scriptId} from pull zone ${state.pullZoneId}`,
        `Apply the site edge rules and cache settings to pull zone ${state.pullZoneId}`,
        "Rewrite _bunny/site.json as state version 2",
        state.current
          ? `Republish deploy ${state.current}`
          : "Point the rewrite rule at the placeholder (no published deploy)",
        ...(args["keep-script"]
          ? []
          : [`Delete edge script ${state.scriptId}`]),
      ];
      if (output === "json") {
        logger.log(
          JSON.stringify({ site: state.name, dryRun: true, actions }, null, 2),
        );
        return;
      }
      logger.info(`Would migrate "${state.name}":`);
      for (const action of actions) logger.dim(`  ${action}`);
      return;
    }

    requireConfirmable(output, {
      force,
      message: `Migrating "${state.name}" needs a confirmation prompt.`,
      hint: "Re-run with --force to migrate non-interactively.",
    });
    const confirmed = await confirm(
      `Migrate "${state.name}" to the edge-rule architecture? It briefly serves its raw storage origin while the rules land.`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const result = await withSpinner(`Migrating "${state.name}"...`, (spin) =>
      migrateSite({
        coreClient,
        computeClient,
        legacy: state,
        storageZone: site.storageZone,
        connection: site.connection,
        keepScript: args["keep-script"],
        onStep: (message) => {
          spin.text = message;
        },
      }),
    );

    const systemHost = result.state.domain
      ? undefined
      : await fetchSystemHostname(coreClient, result.state.pullZoneId);
    const production = productionUrl(result.state, systemHost);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            site: state.name,
            migrated: true,
            storageZoneId: state.storageZoneId,
            pullZoneId: state.pullZoneId,
            detachedScriptId: result.detachedScriptId,
            deploy: result.state.current ?? null,
            production: production ?? null,
            scriptDeleted: result.scriptDeleted,
            ...(result.scriptError ? { scriptError: result.scriptError } : {}),
          },
          null,
          2,
        ),
      );
      return;
    }

    reportText(state, result, production);
  },
});
