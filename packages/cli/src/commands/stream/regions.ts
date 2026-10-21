import { storageRegions } from "@/commands/storage/constants.ts";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import {
  type StorageRegionModel,
  storageRegionsList,
} from "@/tools/storage/index.ts";
import {
  MAIN_REGION,
  REGION_CODES,
  SUGGESTED_REPLICATION_REGIONS,
} from "@/tools/stream/index.ts";

export function regionName(
  catalog: StorageRegionModel[],
  code: string,
): string {
  return (
    storageRegions(catalog).find((region) => region.code === code)?.name ?? code
  );
}

function streamRegions(catalog: StorageRegionModel[]) {
  return REGION_CODES.map((code) => ({
    code,
    name: regionName(catalog, code),
    main: code === MAIN_REGION,
    suggested: SUGGESTED_REPLICATION_REGIONS.includes(code),
  }));
}

export const streamRegionsCommand = defineToolCommand({
  tool: storageRegionsList,
  command: "regions",
  describe: "List the regions a video library can replicate to.",
  examples: [["$0 stream regions", "List every Stream region"]],
  progress: "Fetching regions...",

  prepare: async () => ({ input: {} }),

  json: (catalog) => streamRegions(catalog),

  render: (catalog, { output }) => {
    logger.log(
      formatTable(
        ["Code", "Name", "Role", "Suggested"],
        streamRegions(catalog).map((region) => [
          region.code,
          region.name,
          region.main ? "main" : "replication",
          region.suggested ? "yes" : "no",
        ]),
        output,
      ),
    );
    logger.dim(
      `${MAIN_REGION} is the fixed main region. Pick replicas with \`bunny stream libraries create --replication-regions\`, or add them later with \`libraries update --add-replication-regions\`. Replicas can't be removed once added.`,
    );
  },
});
