import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../../config/index.ts";
import { clientOptions } from "../../../../core/client-options.ts";
import { UserError } from "../../../../core/errors.ts";
import {
  createHostnamesCommands,
  type ResolvedPullZone,
} from "../../../../core/hostnames/index.ts";
import type { OutputFormat } from "../../../../core/types.ts";
import type { StorageZoneModel } from "../../api.ts";
import { resolveStorageZoneInteractive } from "../../interactive.ts";

// Pick the storage zone's linked pull zone; require --pull-zone when several exist.
function resolvePullZoneId(zone: StorageZoneModel, flag?: number): number {
  const zones = zone.PullZones ?? [];

  if (flag != null) {
    const match = zones.find((z) => z.Id === flag);
    if (!match) {
      throw new UserError(
        `Pull zone ${flag} is not linked to storage zone ${zone.Name}.`,
      );
    }
    return flag;
  }

  if (zones.length === 0) {
    throw new UserError(
      `Storage zone ${zone.Name} has no pull zone.`,
      'Create one with "bunny storage zone add --pull-zone".',
    );
  }

  if (zones.length > 1) {
    const list = zones.map((z) => `${z.Id} (${z.Name})`).join(", ");
    throw new UserError(
      "Storage zone has multiple pull zones.",
      `Pass --pull-zone <id> to choose one: ${list}`,
    );
  }

  const id = zones[0]?.Id;
  if (id == null) throw new UserError("Linked pull zone has no ID.");
  return id;
}

async function resolveStorageZonePullZone(args: {
  profile: string;
  apiKey?: string;
  verbose: boolean;
  output: OutputFormat;
  zone?: string;
  "pull-zone"?: number;
}): Promise<ResolvedPullZone> {
  const config = resolveConfig(args.profile, args.apiKey, args.verbose);
  const coreClient = createCoreClient(clientOptions(config, args.verbose));

  // Explicit ref → linked zone (.bunny/storage.json) → interactive picker, like every other storage command.
  const zone = await resolveStorageZoneInteractive(
    coreClient,
    args.zone,
    args.output,
  );
  const pullZoneId = resolvePullZoneId(zone, args["pull-zone"]);

  return { pullZoneId, coreClient };
}

export const storageZoneHostnamesCommands = createHostnamesCommands({
  commandPath: "storage zone domains",
  namespace: "domains",
  describe: "Manage custom domains for a storage zone's pull zone.",
  hiddenAliases: ["hostnames"],
  targetPositional: {
    name: "zone",
    describe: "Storage zone name or ID",
    type: "string",
  },
  target: (yargs) =>
    yargs.option("pull-zone", {
      type: "number",
      describe: "Pull zone ID (required if the storage zone has multiple)",
    }),
  resolve: (args) =>
    resolveStorageZonePullZone({
      profile: args.profile,
      apiKey: args.apiKey,
      verbose: args.verbose,
      output: args.output,
      zone: args.zone as string | undefined,
      "pull-zone": args["pull-zone"] as number | undefined,
    }),
});
