import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatKeyValue } from "../../../core/format.ts";
import {
  addHostname,
  createPullZone,
  normalizeHostname,
  setupHostname,
  systemHostname,
} from "../../../core/hostnames/index.ts";
import { logger } from "../../../core/logger.ts";
import { loadManifest } from "../../../core/manifest.ts";
import { confirm, isInteractive, spinner } from "../../../core/ui.ts";
import { readEnvValue, writeEnvValue } from "../../../utils/env-file.ts";
import {
  type CoreClient,
  fetchStorageZone,
  type StorageZoneModel,
  toSafeStorageZone,
} from "../api.ts";
import {
  CONNECTION_TYPES,
  type ConnectionType,
  connectionChoices,
  connectionJson,
  connectionRows,
  hasSecret,
  type StorageConnection,
  storageConnection,
} from "../connection.ts";
import {
  confirmAddedReplicationRegions,
  normalizeReplicationRegions,
  replicationChoices,
  SSD_PRIMARY_REGION,
  STORAGE_MANIFEST,
  STORAGE_REGIONS,
  type StorageZoneManifest,
  ZONE_TIER_CHOICES,
  type ZoneTierChoice,
  zoneTierValue,
} from "../constants.ts";
import { writeStorageManifest } from "../interactive.ts";
import { isS3Enabled } from "../s3.ts";
import { zoneDetailRows } from "./details.ts";

async function zoneWithPassword(
  client: CoreClient,
  zone: StorageZoneModel,
): Promise<StorageZoneModel> {
  if (zone.Password || !zone.Id) return zone;
  return fetchStorageZone(client, zone.Id);
}

function saveConnectionEnv(connection: StorageConnection): void {
  const envPath = connection.env
    .map(({ key }) => readEnvValue(key)?.envPath)
    .find(Boolean);
  for (const { key, value } of connection.env) {
    writeEnvValue(key, value, envPath);
  }
}

interface ZoneAddArgs {
  name?: string;
  region?: string;
  tier?: ZoneTierChoice;
  s3?: boolean;
  replication?: string[];
  pullZone?: boolean;
  pullZoneName?: string;
  domain?: string;
  link?: boolean;
  connection?: ConnectionType;
  saveEnv?: boolean;
  force?: boolean;
}

export const storageZoneAddCommand = defineCommand<ZoneAddArgs>({
  command: "add [name]",
  describe: "Create a new storage zone.",
  examples: [
    [
      "$0 storage zones add",
      "Interactive: prompts for name, tier, region, and S3",
    ],
    [
      "$0 storage zones add my-zone --region DE",
      "Create a zone in Falkenstein",
    ],
    [
      "$0 storage zones add my-zone --region NY --replication LA,SG",
      "Create a zone with replication regions",
    ],
    [
      "$0 storage zones add my-zone --tier ssd --s3",
      "Create an SSD zone (always DE) with S3-compatible access",
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
      .option("tier", {
        type: "string",
        choices: ZONE_TIER_CHOICES,
        describe: "Storage tier: hdd (Standard) or ssd (Edge)",
      })
      .option("s3", {
        type: "boolean",
        describe: "Enable S3-compatible API access on the zone",
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
      .option("link", {
        type: "boolean",
        describe:
          "Link this directory to the new zone (skips prompt). Use --no-link to skip without prompting.",
      })
      .option("connection", {
        type: "string",
        choices: CONNECTION_TYPES,
        describe: "Show connection details for ftp (FTP/HTTP API) or s3",
      })
      .option("save-env", {
        type: "boolean",
        describe: "Save the connection details to .env (needs --connection)",
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
    tier,
    s3,
    replication,
    pullZone,
    pullZoneName,
    domain,
    link,
    connection,
    saveEnv,
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

    // Region, tier, and replication all drive storage pricing, so flag it up front.
    if (
      interactive &&
      (region === undefined || tier === undefined || replication === undefined)
    ) {
      logger.dim("Region, tier, and replication all affect storage pricing.");
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

    // Asked before the region because Edge (SSD) fixes it. Neither can change later.
    let zoneTier = tier;
    if (!zoneTier && interactive) {
      const { picked } = await prompts({
        type: "select",
        name: "picked",
        message: "Storage tier:",
        choices: [
          {
            title: "Standard (HDD)",
            description: "Lower cost, any primary region",
            value: "hdd" as const,
          },
          {
            title: "Edge (SSD)",
            description: `Faster reads, higher cost, ${SSD_PRIMARY_REGION} only`,
            value: "ssd" as const,
          },
        ],
      });
      if (picked === undefined) throw new UserError("Creation cancelled.");
      zoneTier = picked;
    }

    // The main region cannot be changed after creation, so prompt for it too.
    let mainRegion = region;
    if (zoneTier === "ssd") {
      // The API would rewrite this to DE without saying so.
      if (mainRegion && mainRegion.toUpperCase() !== SSD_PRIMARY_REGION) {
        throw new UserError(
          `The Edge (SSD) tier is only available with ${SSD_PRIMARY_REGION} as the main region, but --region ${mainRegion} was given.`,
          `Drop --region to use ${SSD_PRIMARY_REGION}, or pass --tier hdd to keep ${mainRegion.toUpperCase()}. Replication regions are unaffected.`,
        );
      }
      mainRegion = SSD_PRIMARY_REGION;
      if (interactive) {
        logger.dim(
          `Edge (SSD) zones are always stored in ${SSD_PRIMARY_REGION} first. Replication can still span other regions.`,
        );
      }
    } else if (!mainRegion && interactive) {
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

    let s3Enabled = s3;
    if (s3Enabled === undefined && interactive) {
      logger.dim("S3 compatibility cannot be turned on later.");
      s3Enabled = await confirm("Enable S3 compatibility?", { initial: true });
    }

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
      logger.log("Cancelled.");
      return;
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
          // Omitted when unset so the API keeps applying its own defaults.
          ZoneTier: zoneTier ? zoneTierValue(zoneTier) : undefined,
          StorageZoneType:
            s3Enabled === undefined ? undefined : s3Enabled ? 1 : 0,
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

      // No prompts here, so the follow-ups are flag-driven.
      const linked = link === true && Boolean(created);
      if (linked && created) writeStorageManifest(created);

      const conn =
        connection && created
          ? storageConnection(
              await zoneWithPassword(client, created),
              connection,
            )
          : undefined;

      const savedToEnv = Boolean(saveEnv && conn);
      if (savedToEnv && conn) saveConnectionEnv(conn);

      logger.log(
        JSON.stringify(
          {
            ...(created ? toSafeStorageZone(created) : { Name: zoneName }),
            PullZone: pullZoneResult ?? null,
            CustomDomain: customDomainResult ?? null,
            Linked: linked,
            Connection: conn ? connectionJson(conn) : null,
            SavedToEnv: savedToEnv,
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
    if (created) {
      logger.log();
      logger.log(
        formatKeyValue(zoneDetailRows(created, { usage: false }), output),
      );
      logger.log();
    }
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
          sslHint: `bunny storage zones domains ssl ${host} ${zoneName}`,
          retryHint: `bunny storage zones domains add ${host} ${zoneName}`,
          forceSsl: true,
          interactive,
          verbose,
        });
      }
    }

    if (!created) return;

    const existing = loadManifest<StorageZoneManifest>(STORAGE_MANIFEST);
    let shouldLink = link;
    if (shouldLink === undefined && interactive) {
      shouldLink = await confirm(
        existing.id && existing.id !== zoneId
          ? `Link this directory to ${zoneName}? (replaces the existing link to ${existing.name ?? existing.id})`
          : `Link this directory to ${zoneName}?`,
      );
    }
    if (shouldLink) {
      writeStorageManifest(created);
      logger.success(`Linked this directory to storage zone ${zoneName}.`);
    }

    let connectionType = connection;
    if (connectionType === undefined && interactive) {
      const choices = connectionChoices(created);
      if (await confirm("Show connection details?")) {
        const { picked } = await prompts({
          type: "select",
          name: "picked",
          message: "Connection type:",
          choices,
        });
        connectionType = picked;
      }
    }

    if (connectionType) {
      const zoneWithSecret = await zoneWithPassword(client, created);
      if (connectionType === "s3" && !isS3Enabled(zoneWithSecret)) {
        logger.warn(
          `S3 is not enabled on ${zoneName}, so these credentials will not work.`,
        );
      }
      const conn = storageConnection(zoneWithSecret, connectionType);
      logger.log();
      logger.log(`${conn.label} connection`);
      logger.log(formatKeyValue(connectionRows(conn), output));
      if (hasSecret(conn)) {
        logger.warn("Treat these credentials like a password.");
      }

      let shouldSaveEnv = saveEnv;
      const clash = conn.env.find(({ key }) => readEnvValue(key));
      if (shouldSaveEnv === undefined && interactive) {
        shouldSaveEnv = await confirm(
          clash
            ? `${clash.key} already exists in ${readEnvValue(clash.key)?.envPath}. Overwrite?`
            : "Save these credentials to .env?",
        );
      }
      if (shouldSaveEnv) {
        saveConnectionEnv(conn);
        logger.success(
          `Saved ${conn.env.map(({ key }) => key).join(", ")} to .env`,
        );
      }
    }

    logger.dim(
      `  Upload files:  bunny storage files upload <file> -z ${zoneName}`,
    );
    logger.dim(`  Credentials:   bunny storage zones credentials ${zoneName}`);
  },
});
