import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { saveManifest } from "../../../core/manifest.ts";
import { spinner } from "../../../core/ui.ts";
import { fetchZones, resolveZone } from "../api.ts";
import { DNS_MANIFEST } from "../constants.ts";

interface LinkArgs {
  domain?: string;
}

export const dnsZoneLinkCommand = defineCommand<LinkArgs>({
  command: "link [domain]",
  describe: `Link this directory to a DNS zone (writes .bunny/${DNS_MANIFEST}).`,
  examples: [
    ["$0 dns zones link example.com", "Link by domain or zone ID"],
    ["$0 dns zones link", "Pick a zone interactively"],
  ],

  builder: (yargs) =>
    yargs.positional("domain", {
      type: "string",
      describe: "Domain or zone ID",
    }),

  handler: async ({ domain, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // Resolve an explicit reference, otherwise prompt over every zone — never
    // reuse the manifest here, since linking is how the manifest is (re)set.
    const zone = await (async () => {
      if (domain) {
        const spin = spinner("Resolving zone...");
        spin.start();
        try {
          return await resolveZone(client, domain);
        } finally {
          spin.stop();
        }
      }

      const spin = spinner("Fetching zones...");
      spin.start();
      let zones: Awaited<ReturnType<typeof fetchZones>>;
      try {
        zones = await fetchZones(client);
      } finally {
        spin.stop();
      }

      if (zones.length === 0) {
        throw new UserError(
          "No DNS zones found.",
          'Create one with "bunny dns zones add <domain>".',
        );
      }

      const { selected } = await prompts({
        type: "select",
        name: "selected",
        message: "Zone to link:",
        choices: zones.map((z) => ({ title: z.Domain ?? "", value: z })),
      });
      if (!selected) throw new UserError("Link cancelled.");
      return selected;
    })();

    saveManifest(DNS_MANIFEST, {
      id: zone.Id,
      domain: zone.Domain ?? undefined,
    });

    if (output === "json") {
      logger.log(JSON.stringify({ id: zone.Id, domain: zone.Domain }));
      return;
    }

    logger.success(`Linked to ${zone.Domain} (${zone.Id}).`);
  },
});
