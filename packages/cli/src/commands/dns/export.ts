import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { resolveZoneInteractive } from "./interactive.ts";

interface ExportArgs {
  domain?: string;
  file?: string;
  save?: boolean;
}

export const dnsExportCommand = defineCommand<ExportArgs>({
  command: "export [domain]",
  describe: "Export a zone's records as a BIND zone file.",
  examples: [
    ["$0 dns export example.com", "Print the zone file to stdout"],
    ["$0 dns export example.com --file ./example.zone", "Write to a path"],
    ["$0 dns export example.com --save", "Write to ./example.com.zone"],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .option("file", {
        type: "string",
        describe: "Write the zone file to this path instead of stdout",
      })
      .option("save", {
        type: "boolean",
        default: false,
        describe: "Write to <domain>.zone in the current directory",
      }),

  handler: async ({ domain, file, save, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain);

    const spin = spinner("Exporting zone...");
    spin.start();
    const { data } = await client.GET("/dnszone/{id}/export", {
      params: { path: { id: zone.Id as number } },
      parseAs: "text",
    });
    spin.stop();

    const zonefile = (data as string) ?? "";

    const outPath = file ?? (save ? `${zone.Domain}.zone` : undefined);
    if (outPath) {
      await Bun.write(outPath, zonefile);
      if (output === "json") {
        logger.log(
          JSON.stringify({ domain: zone.Domain, file: outPath }, null, 2),
        );
        return;
      }
      logger.success(`Exported ${zone.Domain} to ${outPath}.`);
      return;
    }

    if (output === "json") {
      logger.log(JSON.stringify({ domain: zone.Domain, zonefile }, null, 2));
      return;
    }

    logger.log(zonefile);
  },
});
