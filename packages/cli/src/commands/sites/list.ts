import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { withSpinner } from "../../core/ui.ts";
import { fetchSites } from "./api.ts";

export const sitesListCommand = defineCommand({
  command: "list",
  aliases: ["ls"],
  describe: "List your sites.",
  examples: [
    ["$0 sites list", "List sites"],
    ["$0 sites list --output json", "JSON output"],
  ],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const sites = await withSpinner("Fetching sites...", () =>
      fetchSites(client),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          sites.map((s) => ({
            name: s.state.name,
            storageZoneId: s.state.storageZoneId,
            pullZoneId: s.state.pullZoneId,
            scriptId: s.state.scriptId,
            domain: s.state.domain ?? null,
            hostname: s.systemHostname ?? null,
            current: s.state.current ?? null,
            deploys: s.state.deploys.length,
          })),
          null,
          2,
        ),
      );
      return;
    }

    if (sites.length === 0) {
      logger.info("No sites found.");
      logger.dim("  Create one with `bunny sites create <name>`.");
      return;
    }

    logger.log(
      formatTable(
        ["Name", "URL", "Deploys", "Current"],
        sites.map((s) => [
          s.state.name,
          s.state.domain
            ? `https://${s.state.domain}`
            : s.systemHostname
              ? `https://${s.systemHostname}`
              : "-",
          String(s.state.deploys.length),
          s.state.current ?? "-",
        ]),
        output,
      ),
    );
  },
});
