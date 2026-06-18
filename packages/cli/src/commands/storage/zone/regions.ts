import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { fetchStorageRegions, type StorageRegionModel } from "../api.ts";

export const storageZoneRegionsCommand = defineCommand({
  command: "regions",
  describe: "List available storage zone regions.",
  examples: [["$0 storage zones regions", "List storage regions"]],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const spin = spinner("Fetching storage regions...");
    spin.start();
    let regions: StorageRegionModel[];
    try {
      regions = await fetchStorageRegions(client);
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify(regions, null, 2));
      return;
    }

    logger.log(
      formatTable(
        ["Code", "Name", "Endpoint"],
        regions.map((r) => [r.Id ?? "", r.Name ?? "", r.Url ?? ""]),
        output,
      ),
    );
  },
});
