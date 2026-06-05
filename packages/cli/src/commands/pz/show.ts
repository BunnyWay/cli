import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatKeyValue } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import { PULL_ZONE_MANIFEST, type PullZoneManifest } from "./constants.ts";

interface ShowArgs {
  id?: number;
}

export const pzShowCommand = defineCommand<ShowArgs>({
  command: "show [id]",
  describe: "Show pull zone details.",
  examples: [
    ["$0 pz show", "Show selected pull zone"],
    ["$0 pz show 12345", "Show pull zone 12345"],
  ],

  builder: (yargs) =>
    yargs.positional("id", {
      type: "number",
      describe: "Pull zone ID (uses selected one if omitted)",
    }),

  handler: async ({ id, profile, output, verbose, apiKey }) => {
    const zoneId = id ?? loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST).id;
    if (!zoneId) {
      throw new UserError(
        "No pull zone specified.",
        'Pass a pull zone ID or run "bunny pz link" first.',
      );
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const spin = spinner("Fetching pull zone...");
    spin.start();

    let zone: components["schemas"]["PullZoneModel"] | undefined;

    try {
      const { data } = await client.GET("/pullzone/{id}", {
        params: { path: { id: zoneId } },
      });
      zone = data as components["schemas"]["PullZoneModel"] | undefined;
    } catch (err: unknown) {
      spin.stop();
      const msg = err instanceof Error ? err.message : String(err);
      throw new UserError(`Fetching failed: ${msg}`);
    }

    spin.stop();

    if (!zone) {
      throw new UserError(`Pull zone ${zoneId} not found.`);
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

    const security = zone.ZoneSecurityEnabled ? "Enabled" : "Disabled";

    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: String(zone.Id ?? "") },
          { key: "Name", value: zone.Name ?? "" },
          { key: "Origin", value: zone.OriginUrl ?? "" },
          { key: "Status", value: status },
          { key: "Hostnames", value: hostnames },
          { key: "Storage Zone ID", value: String(zone.StorageZoneId ?? "") },
          { key: "Edge Script ID", value: String(zone.EdgeScriptId ?? "") },
          { key: "Security", value: security },
        ],
        output,
      ),
    );
  },
});
