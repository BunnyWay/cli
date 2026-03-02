import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { clientOptions } from "../../../core/client-options.ts";

const COMMAND = "list";
const DESCRIPTION = "List available regions.";

export const appsRegionsListCommand = defineCommand({
  command: COMMAND,
  describe: DESCRIPTION,
  aliases: ["ls"],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching regions...");
    spin.start();

    const { data } = await client.GET("/regions");

    spin.stop();

    const regions = data?.items ?? [];

    if (output === "json") {
      logger.log(JSON.stringify(regions, null, 2));
      return;
    }

    if (regions.length === 0) {
      logger.info("No regions available.");
      return;
    }

    const rows = regions.map((r) => [
      r.id ?? "",
      r.name ?? "",
      r.group ?? "",
      r.hasAnycastSupport ? "Yes" : "No",
      r.hasCapacity ? "Yes" : "No",
    ]);

    logger.log(
      formatTable(
        ["ID", "Name", "Group", "Anycast", "Capacity"],
        rows,
        output,
      ),
    );
  },
});
