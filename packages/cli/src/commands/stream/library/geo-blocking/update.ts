import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import {
  GEO_PRESET_IDS,
  streamGeoBlockingUpdate,
} from "@/tools/stream/index.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import { libraryPositional, renderGeoBlocking } from "./render.ts";

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
