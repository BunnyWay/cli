import { pullZonesGet, pullZonesList } from "@bunny.net/tools/pullzones";
import { CANCELLED, defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { saveManifest } from "@/core/manifest.ts";
import { prompts } from "@/core/ui.ts";
import { PULL_ZONE_MANIFEST, type PullZoneManifest } from "./constants.ts";

export const pzLinkCommand = defineToolCommand({
  tool: pullZonesGet,
  command: "link [id]",
  describe: "Link the current directory to a pull zone.",
  examples: [
    ["$0 pz link", "Interactive selection"],
    ["$0 pz link 12345", "Link by ID"],
  ],
  progress: "Fetching pull zone...",

  builder: (yargs) =>
    yargs.positional("id", {
      type: "number",
      describe: "Pull zone ID",
    }),

  prepare: async ({ id }, ctx) => {
    if (id) return { input: { pullZone: id } };

    const zones = await pullZonesList.invoke(ctx, {});
    if (zones.length === 0) {
      throw new UserError(
        "No pull zones found.",
        'Run "bunny pz create" to create one.',
      );
    }

    const { selected } = await prompts({
      type: "select",
      name: "selected",
      message: "Link to a pull zone:",
      choices: zones.map((zone) => ({ title: zone.name, value: zone.id })),
    });
    if (!selected) return CANCELLED;
    return { input: { pullZone: selected as number } };
  },

  after: (zone) => {
    saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, {
      id: zone.id,
      name: zone.name,
    });
  },

  render: (zone) => {
    logger.success(`Linked to ${zone.name}.`);
  },
});
