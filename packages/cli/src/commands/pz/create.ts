import { pullZonesCreate } from "@bunny.net/tools/pullzones";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { saveManifest } from "@/core/manifest.ts";
import { confirm } from "@/core/ui.ts";
import { PULL_ZONE_MANIFEST, type PullZoneManifest } from "./constants.ts";

export const pzCreateCommand = defineToolCommand({
  tool: pullZonesCreate,
  command: "create <name> <origin>",
  describe: "Create a new pull zone.",
  examples: [
    ["$0 pz create my-zone https://origin.example.com", "Create a pull zone"],
  ],
  progress: "Creating pull zone...",

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Pull zone name",
        demandOption: true,
      })
      .positional("origin", {
        type: "string",
        describe: "Origin URL (https:// is prepended if missing)",
        demandOption: true,
      }),

  prepare: async ({ name, origin }) => ({ input: { name, origin } }),

  // An awaited offer, so it lives here rather than in render; JSON callers get no prompt.
  after: async (zone, { output }) => {
    if (output === "json") return;
    logger.success(`Pull zone "${zone.name}" created.`);
    const link = await confirm(`Link this directory to "${zone.name}"?`, {
      optional: true,
    });
    if (!link) return;
    saveManifest<PullZoneManifest>(PULL_ZONE_MANIFEST, {
      id: zone.id,
      name: zone.name,
    });
    logger.success(`Linked to ${zone.name}.`);
  },

  render: () => {},
});
