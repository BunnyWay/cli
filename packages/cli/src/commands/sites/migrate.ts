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
import { confirm, requireConfirmable, withSpinner } from "../../core/ui.ts";
import {
  type CoreClient,
  fetchStorageZone,
  resolveStorageZone,
  type StorageZoneModel,
} from "../storage/api.ts";
import {
  classifySiteZone,
  fetchSystemHostname,
  migrateSite,
  siteFiles,
  type ZoneState,
} from "./api.ts";
import { SITES_MANIFEST, type SiteManifest } from "./constants.ts";
import { productionUrl } from "./deploy.ts";
import { sitePositionalBuilder } from "./interactive.ts";

interface MigrateArgs {
  site?: string;
  force?: boolean;
}

// No picker or name scan: `selectSite` can't see these sites at all, and whoever reaches for this command already knows which one is stuck.
async function selectZone(
  client: CoreClient,
  ref?: string,
): Promise<StorageZoneModel> {
  if (ref) return resolveStorageZone(client, ref);
  const { id } = loadManifest<SiteManifest>(SITES_MANIFEST);
  if (!id) {
    throw new UserError(
      "No site specified and no linked site found.",
      "Pass the site's storage zone name or ID (see `bunny storage zones list`).",
    );
  }
  return fetchStorageZone(client, id);
}

function requireLegacy(
  zone: ZoneState,
  ref: string,
): Extract<ZoneState, { kind: "legacy" }> {
  if (zone.kind === "legacy") return zone;
  if (zone.kind === "current") {
    throw new UserError(
      `Site "${zone.state.name}" is already on the edge-rule architecture.`,
      "Deploy it as usual with `bunny sites deploy`.",
    );
  }
  throw new UserError(
    `"${ref}" is not a router-era site.`,
    "Only sites created before edge rules replaced the router script need migrating.",
  );
}

// Hidden and deliberately minimal: it exists for the sites deployed before edge rules replaced the router script, and comes out once they are all across.
export const sitesMigrateCommand = defineCommand<MigrateArgs>({
  command: "migrate [site]",
  describe: "Migrate a router-era site to the edge-rule architecture.",
  hidden: true,

  builder: (yargs) =>
    sitePositionalBuilder(yargs).option("force", {
      alias: "f",
      type: "boolean",
      default: false,
      describe: "Skip confirmation prompts",
    }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey, force } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    const zone = await withSpinner("Resolving site...", () =>
      selectZone(coreClient, args.site),
    );
    const legacy = requireLegacy(
      await classifySiteZone(zone),
      args.site ?? String(zone.Id),
    );
    const { name } = legacy.state;

    requireConfirmable(output, {
      force,
      message: `Migrating "${name}" needs a confirmation prompt.`,
      hint: "Re-run with --force to migrate non-interactively.",
    });
    const confirmed = await confirm(
      `Migrate "${name}" to the edge-rule architecture? It briefly serves its raw storage origin while the rules land.`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const result = await withSpinner(`Migrating "${name}"...`, (spin) =>
      migrateSite({
        coreClient,
        computeClient,
        legacy: legacy.state,
        expectedEtag: legacy.etag,
        storageZone: zone,
        connection: siteFiles.connect(zone),
        onStep: (message) => {
          spin.text = message;
        },
      }),
    );

    logger.success(`Migrated "${name}" to the edge-rule architecture.`);
    if (result.scriptError) {
      logger.warn(
        `Couldn't delete edge script ${result.detachedScriptId}: ${result.scriptError}`,
      );
    } else if (
      result.detachedScriptId != null &&
      result.deletedScriptId === null
    ) {
      logger.warn(
        `Detached edge script ${result.detachedScriptId}, but left it in place: it isn't this site's router. Remove it with \`bunny scripts delete ${result.detachedScriptId}\` if nothing else uses it.`,
      );
    }
    if (result.state.current) {
      const systemHost = result.state.domain
        ? undefined
        : await fetchSystemHostname(coreClient, result.state.pullZoneId);
      const production = productionUrl(result.state, systemHost);
      if (production) logger.info(`Production: ${production}`);
    } else {
      logger.info(
        "The site has no published deploy; run `bunny sites deploy`.",
      );
    }

    logger.warn(
      "Edge rules don't redirect `/path` to `/path/` the way the router did.",
    );
  },
});
