import { pullZonesPurge } from "@bunny.net/tools/pullzones";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { resolvePullZoneId } from "./constants.ts";

export const pzPurgeCommand = defineToolCommand({
  tool: pullZonesPurge,
  command: "purge [id]",
  describe: "Purge cached files for a pull zone.",
  examples: [
    ["$0 pz purge", "Purge cache for selected pull zone"],
    ["$0 pz purge 12345", "Purge cache for pull zone 12345"],
  ],
  progress: "Purging cache...",

  builder: (yargs) =>
    yargs.positional("id", {
      type: "number",
      describe: "Pull zone ID (uses selected one if omitted)",
    }),

  prepare: async ({ id }) => ({ input: { pullZone: resolvePullZoneId(id) } }),

  render: ({ id }) => {
    logger.success(`Cache purged for pull zone ${id}.`);
  },
});
