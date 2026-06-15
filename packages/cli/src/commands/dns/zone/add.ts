import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import type { DnsZoneModel } from "../api.ts";

interface ZoneAddArgs {
  domain: string;
}

export const dnsZoneAddCommand = defineCommand<ZoneAddArgs>({
  command: "add <domain>",
  describe: "Create a new DNS zone.",
  examples: [["$0 dns zones add example.com", "Create a zone for example.com"]],

  builder: (yargs) =>
    yargs.positional("domain", {
      type: "string",
      describe: "Domain to create the zone for",
      demandOption: true,
    }),

  handler: async ({ domain, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const spin = spinner("Creating DNS zone...");
    spin.start();

    let created: DnsZoneModel | undefined;
    try {
      await client.POST("/dnszone", { body: { Domain: domain } });

      // Look the new zone up to report its ID; a lookup failure must not mask the created zone.
      try {
        const { data } = await client.GET("/dnszone", {
          params: { query: { search: domain, perPage: 1000 } },
        });
        created = (data?.Items ?? []).find(
          (z) => (z.Domain ?? "").toLowerCase() === domain.toLowerCase(),
        );
      } catch {}
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify(created ?? { Domain: domain }, null, 2));
      return;
    }

    logger.success(
      created?.Id
        ? `Created DNS zone ${domain} (ID: ${created.Id}).`
        : `Created DNS zone ${domain}.`,
    );
  },
});
