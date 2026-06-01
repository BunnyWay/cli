import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";

interface PullZone {
  Id: number;
  Name?: string | null;
  OriginUrl?: string | null;
  Enabled: boolean;
  Suspended: boolean;
}

export const pzListCommand = defineCommand({
  command: "list",
  aliases: ["ls"] as const,
  describe: "List all pull zones.",
  examples: [
    ["$0 pz list", "List all pull zones"],
    ["$0 pz list --output json", "JSON output"],
  ],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const spin = spinner("Fetching pull zones...");
    spin.start();

    const { data } = await client.GET("/pullzone");

    spin.stop();

    const zones = ((data ?? []) as PullZone[]).sort((a: PullZone, b: PullZone) =>
      (a.Name ?? "").localeCompare(b.Name ?? ""),
    );

    if (output === "json") {
      logger.log(JSON.stringify(zones, null, 2));
      return;
    }

    if (zones.length === 0) {
      logger.info("No pull zones found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Origin", "Status"],
        zones.map((zone: PullZone) => [
          String(zone.Id ?? ""),
          zone.Name ?? "",
          zone.OriginUrl ?? "",
          zone.Suspended ? "Suspended" : zone.Enabled ? "Active" : "Disabled",
        ]),
        output,
      ),
    );
  },
});
