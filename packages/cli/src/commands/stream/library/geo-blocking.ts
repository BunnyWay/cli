import { formatLanguageColumns } from "@/commands/stream/library/features.ts";
import { defineCommand } from "@/core/define-command.ts";
import { defineNamespace } from "@/core/define-namespace.ts";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import {
  COUNTRIES,
  COUNTRY_CODES,
  countryName,
  GEO_BLOCKING_DOCS_URL,
  GEO_PRESET_IDS,
  GEO_PRESETS,
  type GeoBlocking,
  streamGeoBlockingGet,
  streamGeoBlockingUpdate,
} from "@/tools/stream/index.ts";
import { resolveLibraryRef } from "./library-ref.ts";

const LIST_HINT =
  "Supported countries and codes: bunny stream libraries geo-blocking countries";

/** Every supported country with its code, in columns for a terminal, else as a table. */
export function formatCountries(output: OutputFormat): string {
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

const libraryPositional = {
  type: "string",
  describe: "Video library name or ID",
} as const;

/** Blocked countries; past half the list it reads better as the few still allowed. */
export function renderGeoBlocking(
  geo: GeoBlocking,
  output: OutputFormat,
): void {
  if (geo.blocked.length === 0) {
    logger.info("Geo-blocking is off: video is delivered to every country.");
    logger.dim(LIST_HINT);
    return;
  }
  const blocked = new Set(geo.blocked);
  const allowed = COUNTRY_CODES.filter((code) => !blocked.has(code));
  const allowMode = allowed.length < geo.blocked.length;
  const list = allowMode ? allowed : geo.blocked;
  logger.log(
    allowMode
      ? `Allowing only ${allowed.length} countr${allowed.length === 1 ? "y" : "ies"}; ${geo.blocked.length} are blocked:`
      : `Blocking ${geo.blocked.length} countr${geo.blocked.length === 1 ? "y" : "ies"}:`,
  );
  logger.log(
    formatTable(
      ["Code", "Country"],
      list.map((code) => [code, countryName(code)]),
      output,
    ),
  );
  logger.dim(LIST_HINT);
}

export const streamLibraryGeoShowCommand = defineToolCommand({
  tool: streamGeoBlockingGet,
  command: "show [library]",
  describe: "Show the countries a video library refuses to deliver video to.",
  examples: [["$0 stream libraries geo-blocking show my-library", "Show it"]],
  progress: "Fetching geo-blocking...",
  builder: (yargs) => yargs.positional("library", libraryPositional),
  prepare: async ({ library, output }, ctx) => {
    const lib = await resolveLibraryRef(ctx, library, { output });
    return { input: { library: lib.id } };
  },
  render: (geo, { output }) => renderGeoBlocking(geo, output),
});

const csv = (values: string[] | undefined) =>
  values?.flatMap((v) => String(v).split(",")).filter((v) => v.trim());

export const streamLibraryGeoUpdateCommand = defineToolCommand({
  tool: streamGeoBlockingUpdate,
  command: "update [library]",
  aliases: ["set"],
  describe: "Block or allow countries for a video library.",
  examples: [
    [
      "$0 stream libraries geo-blocking update my-library --block CN,RU",
      "Block two countries (added to the current list)",
    ],
    [
      "$0 stream libraries geo-blocking update my-library --unblock RU",
      "Unblock one",
    ],
    [
      "$0 stream libraries geo-blocking update my-library --allow-only GB,IE",
      "Deliver only to the UK and Ireland",
    ],
    [
      "$0 stream libraries geo-blocking update my-library --preset eu",
      "Block every EU country",
    ],
    [
      "$0 stream libraries geo-blocking update my-library --allow-only --preset eea-uk",
      "Deliver only inside the EEA and the UK (GDPR and UK GDPR)",
    ],
    [
      "$0 stream libraries geo-blocking update my-library --allow-only US --preset dach",
      "Mix a preset with codes",
    ],
    [
      "$0 stream libraries geo-blocking update my-library --clear",
      "Turn geo-blocking off",
    ],
  ],
  epilogue:
    "Countries are ISO 3166-1 alpha-2 codes (GB for the United Kingdom, UK is accepted too; XK for Kosovo); `bunny stream libraries geo-blocking countries` lists all 249 supported ones. They are detected from the viewer's IP, so VPNs and proxies can get around it. The list lives on the library's linked Pull Zone and applies to video files, playlists and thumbnails. Presets (`bunny stream libraries geo-blocking presets`) only add countries, to the list of whichever of --block, --set or --allow-only you pass, or to the block list on their own. --allow-only is stored as a block list of every other country.",
  progress: "Updating geo-blocking...",
  builder: (yargs) =>
    yargs
      .positional("library", libraryPositional)
      .option("block", {
        type: "string",
        array: true,
        describe:
          "Countries to add to the block list (comma-separated or repeated)",
      })
      .option("unblock", {
        type: "string",
        array: true,
        describe: "Countries to remove from the block list",
      })
      .option("set", {
        type: "string",
        array: true,
        describe: "Replace the block list with exactly these countries",
      })
      .option("allow-only", {
        type: "string",
        array: true,
        describe:
          "Block every country except these (on its own, with --preset, allows only the preset's countries)",
      })
      .option("preset", {
        type: "string",
        array: true,
        describe: `Add a preset's countries to the list (repeatable): ${GEO_PRESET_IDS.join(", ")}`,
      })
      .option("clear", {
        type: "boolean",
        describe: "Unblock every country (geo-blocking off)",
      }),
  preRun: async (args) => {
    const allowOnly = args["allow-only"];
    const modes = [
      args.block || args.unblock || (args.preset && !args.set && !allowOnly)
        ? "block"
        : undefined,
      args.set ? "set" : undefined,
      allowOnly ? "allow-only" : undefined,
      args.clear ? "clear" : undefined,
    ].filter(Boolean);
    if (modes.length !== 1)
      throw new UserError(
        modes.length === 0
          ? "Nothing to change."
          : "Pass only one of --block/--unblock, --set, --allow-only or --clear.",
        "For example: --block CN,RU, --preset eu, --allow-only GB,IE, or --clear.",
      );
    const named = [...(args.set ?? []), ...(allowOnly ?? [])].filter((v) =>
      String(v).trim(),
    );
    if ((args.set || allowOnly) && named.length === 0 && !args.preset)
      throw new UserError(
        `--${args.set ? "set" : "allow-only"} needs countries or a --preset.`,
      );
  },
  prepare: async (args, ctx) => {
    const lib = await resolveLibraryRef(ctx, args.library, {
      output: args.output,
    });
    return {
      input: {
        library: lib.id,
        block: csv(args.block),
        unblock: csv(args.unblock),
        allowOnly: args["allow-only"]
          ? (csv(args["allow-only"]) ?? [])
          : undefined,
        set: args.set ? (csv(args.set) ?? []) : undefined,
        clear: args.clear || undefined,
        presets: csv(args.preset),
      },
    };
  },
  render: (geo, { output }) => {
    logger.success("Geo-blocking updated.");
    renderGeoBlocking(geo, output);
  },
});

export const streamLibraryGeoBlockingNamespace = defineNamespace(
  "geo-blocking",
  "Block or allow countries from watching a video library's videos.",
  [
    streamLibraryGeoShowCommand,
    streamLibraryGeoUpdateCommand,
    streamLibraryGeoCountriesCommand,
    streamLibraryGeoPresetsCommand,
  ],
  ["geoblocking", "geo"],
);
