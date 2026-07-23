import { storageRegionsList } from "@bunny.net/actions";
import { defineActionCommand } from "../../core/define-action-command.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";

export const storageRegionsCommand = defineActionCommand({
  action: storageRegionsList,
  command: "regions",
  describe: "List available storage regions.",
  examples: [["$0 storage regions", "List storage regions"]],

  prepare: async () => ({ input: {} }),

  render: (regions, { output }) => {
    logger.log(
      formatTable(
        ["Code", "Name"],
        regions.map((region) => [region.code, region.name]),
        output,
      ),
    );
    logger.dim("Replication uses these same regions, minus the primary.");
  },
});
