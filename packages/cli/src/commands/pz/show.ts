import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatKeyValue } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { resolvePullZoneId } from "./resolve-pullzone.ts";

interface PullZone {
  Id: number;
  Name?: string | null;
  OriginUrl?: string | null;
  Enabled: boolean;
  Suspended: boolean;
  Hostnames?: Array<{ Value?: string | null }> | null;
  StorageZoneId?: number;
  EdgeScriptId?: number;
  ZoneSecurityEnabled?: boolean;
  ZoneSecurityKey?: string | null;
}

interface ShowArgs {
  "name-or-id"?: string;
}

export const pzShowCommand = defineCommand<ShowArgs>({
  command: "show [name-or-id]",
  describe: "Show pull zone details.",
  examples: [
    ["$0 pz show", "Show selected pull zone"],
    ["$0 pz show my-zone", "Show by name"],
    ["$0 pz show 12345", "Show by ID"],
  ],

  builder: (yargs) =>
    yargs.positional("name-or-id", {
      type: "string",
      describe: "Pull zone name or ID (uses selected one if omitted)",
    }),

  handler: async ({ "name-or-id": nameOrId, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const { id: zoneId } = await resolvePullZoneId(client, nameOrId);

    const { data } = await client.GET("/pullzone/{id}", {
      params: { path: { id: zoneId } },
    });

    const zone = data as PullZone | undefined;
    if (!zone) {
      logger.error(`Pull zone ${zoneId} not found.`);
      return;
    }

    if (output === "json") {
      logger.log(JSON.stringify(zone, null, 2));
      return;
    }

    const hostnames = zone.Hostnames
      ?.map((h) => h.Value)
      .filter(Boolean)
      .join(", ") ?? "none";

    const status = zone.Suspended
      ? "Suspended"
      : zone.Enabled
        ? "Active"
        : "Disabled";

    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: String(zone.Id) },
          { key: "Name", value: zone.Name ?? "" },
          { key: "Origin", value: zone.OriginUrl ?? "" },
          { key: "Status", value: status },
          { key: "Hostnames", value: hostnames },
          { key: "Storage Zone ID", value: String(zone.StorageZoneId ?? "") },
          { key: "Edge Script ID", value: String(zone.EdgeScriptId ?? "") },
          { key: "Security", value: zone.ZoneSecurityEnabled ? "Enabled" : "Disabled" },
        ],
        output,
      ),
    );
  },
});
