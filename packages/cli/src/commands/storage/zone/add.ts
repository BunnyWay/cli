import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import {
  addHostname,
  createPullZone,
  normalizeHostname,
  setupHostname,
  systemHostname,
} from "../../../core/hostnames/index.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, isInteractive, spinner } from "../../../core/ui.ts";
import { type StorageZoneModel, toSafeStorageZone } from "../api.ts";
import {
  confirmAddedReplicationRegions,
  normalizeReplicationRegions,
  replicationChoices,
  STORAGE_REGIONS,
} from "../constants.ts";

interface ZoneAddArgs {
  name?: string;
  region?: string;
  replication?: string[];
  pullZone?: boolean;
  pullZoneName?: string;
  domain?: string;
  force?: boolean;
}

export const storageZoneAddCommand = defineCommand<ZoneAddArgs>({
  command: "add [name]",
  describe: "Create a new storage zone.",
  examples: [
    ["$0 storage zones add", "Interactive: prompts for name and region"],
    [
      "$0 storage zones add my-zone --region DE",
      "Create a zone in Falkenstein",
    ],
    [
      "$0 storage zones add my-zone --region NY --replication LA,SG",
      "Create a zone with replication regions",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name for the new storage zone",
      })
      .option("region", {
        type: "string",
        describe: "Main storage region code (e.g. DE, NY, LA, SG)",
      })
      .option("replication", {
        type: "string",
        array: true,
        describe: "Replication region codes (comma-separated or repeated)",
      })
      .option("pull-zone", {
        type: "boolean",
        describe: "Create a pull zone to serve the storage zone over the web",
      })
      .option("pull-zone-name", {
        type: "string",
        describe: "Name for the pull zone (defaults to the storage zone name)",
      })
      .option("domain", {
        type: "string",
        describe: "Custom domain to add to the pull zone (implies --pull-zone)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip prompts and confirmations (use flag values only)",
      }),

  handler: async ({
    name,
    region,
    replication,
    pullZone,
    pullZoneName,
    domain,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    // A custom domain needs a pull zone to attach to, so the flags can't conflict.
    if (domain !== undefined && pullZone === false) {
      throw new UserError(
        "--domain requires a pull zone, but --no-pull-zone was given.",
        "Drop --no-pull-zone, or remove --domain to create the zone without one.",
      );
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // JSON output, non-TTY, and --force all stay non-interactive; values must come from flags.
    const interactive = isInteractive(output) && !force;

    // The region and replication choices both drive storage pricing, so flag it up front.
    if (interactive && (region === undefined || replication === undefined)) {
      logger.dim("Region and replication regions both affect storage pricing.");
    }

    let zoneName = name;
    if (!zoneName && interactive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Storage zone name:",
      });
      zoneName = value;
    }
    if (!zoneName) throw new UserError("A storage zone name is required.");

    // The main region cannot be changed after creation, so prompt for it too.
    let mainRegion = region;
    if (!mainRegion && interactive) {
      const { picked } = await prompts({
        type: "select",
        name: "picked",
        message: "Main region:",
        choices: STORAGE_REGIONS.map((r) => ({
          title: `${r.name} (${r.code})`,
          value: r.code,
        })),
      });
      mainRegion = picked;
    }
    if (!mainRegion) {
      throw new UserError(
        "A region is required.",
        "Pass --region with a region code (e.g. DE, NY, LA, SG).",
      );
    }
    mainRegion = mainRegion.toUpperCase();

    let replicationRegions = replication;
    if (replicationRegions === undefined && interactive) {
      const { picked } = await prompts({
        type: "multiselect",
        name: "picked",
        message:
          "Replication regions (each adds storage cost; space to toggle):",
        choices: replicationChoices(mainRegion).map((region) => ({
          title: `${region.name} (${region.code})`,
          value: region.code,
        })),
      });
      // Cancelling (Ctrl+C) yields undefined; an empty array is a deliberate "no replication".
      if (picked === undefined) throw new UserError("Creation cancelled.");
      replicationRegions = picked;
    }
    const replicationCodes = replicationRegions
      ? normalizeReplicationRegions(replicationRegions, mainRegion)
      : [];

    // Replicas can't be removed once added, so confirm before creating a zone with any.
    if (
      replicationCodes.length &&
      !(await confirmAddedReplicationRegions(replicationCodes, { force }))
    ) {
      throw new UserError("Creation cancelled.");
    }

    const spin = spinner("Creating storage zone...");
    spin.start();
    let created: StorageZoneModel | undefined;
    try {
      const { data } = await client.POST("/storagezone", {
        body: {
          Name: zoneName,
          Region: mainRegion,
          ReplicationRegions: replicationCodes.length ? replicationCodes : null,
        },
      });
      created = data;
    } finally {
      spin.stop();
    }

    const zoneId = created?.Id;

    // A storage zone only holds files; a pull zone serves them on the web.
    // A custom domain attaches to that pull zone, so --domain implies one too.
    let shouldCreatePullZone = pullZone ?? (domain !== undefined || undefined);
    if (shouldCreatePullZone === undefined && interactive && zoneId) {
      shouldCreatePullZone = await confirm(
        `Make ${zoneName} available on the web? This creates a pull zone (bunny's CDN layer) in front of it.`,
      );
    }

    let pullZoneResult:
      | { id?: number; name?: string | null; url?: string }
      | undefined;
    if (shouldCreatePullZone && zoneId) {
      const pzSpin = spinner("Creating pull zone...");
      pzSpin.start();
      let pz: Awaited<ReturnType<typeof createPullZone>> | undefined;
      try {
        pz = await createPullZone(client, pullZoneName ?? zoneName, zoneId);
      } finally {
        pzSpin.stop();
      }
      const host = systemHostname(pz?.Hostnames);
      pullZoneResult = {
        id: pz?.Id,
        name: pz?.Name,
        url: host ? `https://${host}` : undefined,
      };
    }

    if (output === "json") {
      // Non-interactive: attach the requested domain to the pull zone (no DNS/SSL
      // prompts; SSL is issued later via `domains ssl` once DNS points at bunny).
      let customDomainResult:
        | { domain: string; cnameTarget?: string; error?: string }
        | undefined;
      if (domain) {
        const host = normalizeHostname(domain);
        if (pullZoneResult?.id) {
          try {
            const { cnameTarget } = await addHostname(
              client,
              pullZoneResult.id,
              host,
            );
            customDomainResult = { domain: host, cnameTarget };
          } catch (err) {
            customDomainResult = {
              domain: host,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        } else {
          customDomainResult = {
            domain: host,
            error: "Pull zone was not created; cannot attach the domain.",
          };
        }
      }

      logger.log(
        JSON.stringify(
          {
            ...(created ? toSafeStorageZone(created) : { Name: zoneName }),
            PullZone: pullZoneResult ?? null,
            CustomDomain: customDomainResult ?? null,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(
      zoneId
        ? `Created storage zone ${zoneName} (ID: ${zoneId}).`
        : `Created storage zone ${zoneName}.`,
    );
    if (pullZoneResult) {
      logger.success(`Created pull zone ${pullZoneResult.name}.`);
      if (pullZoneResult.url) {
        logger.info(`Files are now served at ${pullZoneResult.url}`);
      }
    }

    if (pullZoneResult?.id) {
      let customDomain = domain;
      if (
        customDomain === undefined &&
        interactive &&
        (await confirm("Add a custom domain?"))
      ) {
        const { value } = await prompts({
          type: "text",
          name: "value",
          message: "Domain (e.g. cdn.example.com):",
        });
        customDomain = value;
      }
      if (customDomain) {
        const host = normalizeHostname(customDomain);
        await setupHostname({
          coreClient: client,
          pullZoneId: pullZoneResult.id,
          domain: host,
          sslHint: `bunny storage zone domains ssl ${host} ${zoneName}`,
          retryHint: `bunny storage zone domains add ${host} ${zoneName}`,
          forceSsl: true,
          interactive,
          verbose,
        });
      }
    }
  },
});
