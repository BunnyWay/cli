import { formatLanguageColumns } from "@/commands/stream/library/features.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { COUNTRIES, GEO_BLOCKING_DOCS_URL } from "@/tools/stream/index.ts";

/** Every supported country with its code, in columns for a terminal, else as a table. */
function formatCountries(output: OutputFormat): string {
  // Long names are shortened so the list fits in columns; JSON and the
  // other formats carry them in full.
  if (output === "text")
    return formatLanguageColumns(COUNTRIES, process.stdout.columns || 80, 24);
  return formatTable(
    ["Code", "Country"],
    COUNTRIES.map((c) => [c.code, c.name]),
    output,
  );
}

export const streamLibraryGeoCountriesCommand = defineCommand<object>({
  command: "countries",
  aliases: ["codes"],
  describe:
    "List the countries and territories geo-blocking supports, with their codes.",
  examples: [
    ["$0 stream libraries geo-blocking countries", "Every supported code"],
    [
      "$0 stream libraries geo-blocking countries --output csv",
      "As CSV, for a spreadsheet",
    ],
  ],
  handler: async ({ output }) => {
    if (output === "json") {
      logger.log(JSON.stringify(COUNTRIES, null, 2));
      return;
    }
    if (output === "text")
      logger.log(
        `${COUNTRIES.length} countries and territories (ISO 3166-1 alpha-2; GB for the United Kingdom, XK for Kosovo):`,
      );
    logger.log(formatCountries(output));
    if (output === "text") logger.dim(`  ${GEO_BLOCKING_DOCS_URL}`);
  },
});
