import {
  MAIN_REGION,
  REGION_CODES,
  SUGGESTED_REPLICATION_REGIONS,
} from "@bunny.net/tools/stream";
import { STORAGE_REGIONS } from "@/commands/storage/constants.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";

/** Stream libraries store in the same regions as Storage, so the names come from its catalog. */
export function regionName(code: string): string {
  return STORAGE_REGIONS.find((region) => region.code === code)?.name ?? code;
}

export const streamRegionsCommand = defineCommand({
  command: "regions",
  describe: "List the regions a video library can replicate to.",
  examples: [["$0 stream regions", "List every Stream region"]],

  handler: async ({ output }) => {
    const regions = REGION_CODES.map((code) => ({
      code,
      name: regionName(code),
      main: code === MAIN_REGION,
      suggested: SUGGESTED_REPLICATION_REGIONS.includes(code),
    }));

    if (output === "json") {
      logger.log(JSON.stringify(regions, null, 2));
      return;
    }

    logger.log(
      formatTable(
        ["Code", "Name", "Role", "Suggested"],
        regions.map((region) => [
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
