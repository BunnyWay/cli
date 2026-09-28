import { pullZonesDelete, pullZonesGet } from "@bunny.net/tools/pullzones";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, removeManifest } from "@/core/manifest.ts";
import { confirm } from "@/core/ui.ts";
import {
  PULL_ZONE_MANIFEST,
  type PullZoneManifest,
  resolvePullZoneId,
} from "./constants.ts";

export const pzDeleteCommand = defineToolCommand({
  tool: pullZonesDelete,
  command: "delete [id]",
  describe: "Delete a pull zone.",
  examples: [
    ["$0 pz delete", "Delete selected pull zone"],
    ["$0 pz delete 12345", "Delete pull zone 12345"],
    ["$0 pz delete --force", "Skip confirmation"],
  ],
  progress: "Deleting pull zone...",

  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "number",
        describe: "Pull zone ID (uses selected one if omitted)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation",
      }),

  prepare: async ({ id, force }, ctx) => {
    const zone = await pullZonesGet.invoke(ctx, {
      pullZone: resolvePullZoneId(id),
    });
    return {
      input: { pullZone: zone.id },
      confirm: () =>
        confirm(`Delete pull zone ${zone.name} (${zone.id})?`, { force }),
    };
  },

  after: ({ id }) => {
    if (loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST).id === id) {
      removeManifest(PULL_ZONE_MANIFEST);
    }
  },

  render: ({ id }) => {
    logger.success(`Pull zone ${id} deleted.`);
  },
});
