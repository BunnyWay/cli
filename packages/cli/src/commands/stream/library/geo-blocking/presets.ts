import { defineCommand } from "@/core/define-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { GEO_PRESETS } from "@/tools/stream/index.ts";

/** The presets and their members, grouped as the docs group them. */
export const streamLibraryGeoPresetsCommand = defineCommand<object>({
  command: "presets",
  describe:
    "List the geo-blocking presets (continents, data protection, regions) and the countries in each.",
  examples: [
    ["$0 stream libraries geo-blocking presets", "Every preset"],
    [
      "$0 stream libraries geo-blocking update my-library --allow-only --preset eea-uk",
      "Then use one: deliver only inside the EEA and the UK",
    ],
  ],
  handler: async ({ output }) => {
    const rows = Object.entries(GEO_PRESETS).map(([id, preset]) => ({
      id,
      name: preset.name,
      group: preset.group,
      codes: [...preset.codes],
    }));
    if (output === "json") {
      logger.log(JSON.stringify(rows, null, 2));
      return;
    }
    logger.log(
      formatTable(
        ["Preset", "Name", "Group", "Countries"],
        rows.map((r) => [
          r.id,
          r.name,
          r.group,
          output === "text"
            ? `${r.codes.length}: ${r.codes.join(" ")}`
            : r.codes.join(" "),
        ]),
        output,
      ),
    );
    if (output === "text")
      logger.dim(
        "A preset only adds its countries to the list; combine presets with each other and with codes, then remove any you don't want with --unblock.",
      );
  },
});
