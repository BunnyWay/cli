import { defineCommand } from "../../core/define-command.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { STORAGE_REGIONS } from "./constants.ts";

export const storageRegionsCommand = defineCommand({
  command: "regions",
  describe: "List available storage regions.",
  examples: [["$0 storage regions", "List storage regions"]],

  handler: async ({ output }) => {
    if (output === "json") {
      logger.log(JSON.stringify(STORAGE_REGIONS, null, 2));
      return;
    }

    logger.log(
      formatTable(
        ["Code", "Name"],
        STORAGE_REGIONS.map((region) => [region.code, region.name]),
        output,
      ),
    );
    logger.dim("Replication uses these same regions, minus the primary.");
  },
});
