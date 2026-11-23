import { stat } from "node:fs/promises";
import { defineNamespace } from "@/core/define-namespace.ts";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, requireConfirmable } from "@/core/ui.ts";
import {
  streamWatermarkGet,
  streamWatermarkRemove,
  streamWatermarkSet,
  type Watermark,
} from "@/tools/stream/index.ts";
import { resolveLibraryRef } from "./library-ref.ts";

const APPLIES_TO_NEW =
  "The watermark is burned in while encoding, so it applies to videos uploaded from now on; existing videos keep what they were encoded with.";

const pct = (value: number | null) => (value === null ? "-" : `${value}%`);

function formatWatermark(watermark: Watermark, output: OutputFormat): string {
  return formatKeyValue(
    [
      { key: "Watermark", value: watermark.enabled ? "Set" : "None" },
      { key: "Left", value: pct(watermark.left) },
      { key: "Top", value: pct(watermark.top) },
      { key: "Width", value: pct(watermark.width) },
      { key: "Height", value: pct(watermark.height) },
    ],
    output,
  );
}

const libraryPositional = {
  type: "string",
  describe: "Video library name or ID",
} as const;

export const streamLibraryWatermarkShowCommand = defineToolCommand({
  tool: streamWatermarkGet,
  command: "show [library]",
  describe: "Show a video library's watermark position and size.",
  examples: [["$0 stream libraries watermark show my-library", "Show it"]],
  progress: "Fetching watermark...",
  builder: (yargs) => yargs.positional("library", libraryPositional),
  prepare: async ({ library, output }, ctx) => {
    const lib = await resolveLibraryRef(ctx, library, { output });
    return { input: { library: lib.id } };
  },
  render: (watermark, { output }) => {
    logger.log(formatWatermark(watermark, output));
    if (!watermark.enabled)
      logger.dim(
        "Add one with: bunny stream libraries watermark set --file logo.png",
      );
  },
});

export const streamLibraryWatermarkSetCommand = defineToolCommand({
  tool: streamWatermarkSet,
  command: "set [library]",
  aliases: ["add"],
  describe:
    "Upload a watermark image and/or set its position and size, as percentages of the frame.",
  examples: [
    [
      "$0 stream libraries watermark set my-library --file logo.png --left 85 --top 5 --width 10",
      "Upload a logo in the top-right corner, 10% wide",
    ],
    [
      "$0 stream libraries watermark set my-library --top 85",
      "Move the existing watermark to the bottom",
    ],
  ],
  epilogue: APPLIES_TO_NEW,
  progress: "Setting watermark...",
  builder: (yargs) =>
    yargs
      .positional("library", libraryPositional)
      .option("file", {
        type: "string",
        describe: "Image to upload (PNG with transparency works best)",
      })
      .option("left", {
        type: "number",
        describe: "Left offset, 0-100% of the video width",
      })
      .option("top", {
        type: "number",
        describe: "Top offset, 0-100% of the video height",
      })
      .option("width", {
        type: "number",
        describe: "Width, 0-100% of the video width",
      })
      .option("height", {
        type: "number",
        describe: "Height, 0-100% of the video height",
      }),
  preRun: async (args) => {
    const sizes = [args.left, args.top, args.width, args.height];
    if (args.file === undefined && sizes.every((v) => v === undefined))
      throw new UserError(
        "Nothing to set.",
        "Pass --file <image> and/or --left, --top, --width, --height.",
      );
    for (const [flag, value] of [
      ["left", args.left],
      ["top", args.top],
      ["width", args.width],
      ["height", args.height],
    ] as const) {
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 0 || value > 100)
      )
        throw new UserError(`--${flag} must be a whole percentage, 0-100.`);
    }
    if (args.file !== undefined) {
      const info = await stat(args.file).catch(() => null);
      if (!info?.isFile()) throw new UserError(`Not a file: ${args.file}`);
    }
  },
  prepare: async (args, ctx) => {
    const lib = await resolveLibraryRef(ctx, args.library, {
      output: args.output,
    });
    return {
      input: {
        library: lib.id,
        file: args.file,
        left: args.left,
        top: args.top,
        width: args.width,
        height: args.height,
      },
    };
  },
  render: (watermark, { output }) => {
    logger.success("Watermark set.");
    logger.log(formatWatermark(watermark, output));
    logger.dim(APPLIES_TO_NEW);
  },
});

export const streamLibraryWatermarkRemoveCommand = defineToolCommand({
  tool: streamWatermarkRemove,
  command: "remove [library]",
  aliases: ["rm", "delete"],
  describe: "Delete a video library's watermark image.",
  examples: [
    ["$0 stream libraries watermark remove my-library", "Remove it"],
    ["$0 stream libraries watermark remove my-library --force", "No prompt"],
  ],
  progress: "Removing watermark...",
  builder: (yargs) =>
    yargs.positional("library", libraryPositional).option("force", {
      alias: "f",
      type: "boolean",
      default: false,
      describe: "Skip the confirmation prompt",
    }),
  prepare: async (args, ctx) => {
    const lib = await resolveLibraryRef(ctx, args.library, {
      output: args.output,
      force: args.force,
    });
    requireConfirmable(args.output, {
      force: args.force,
      message: "Removing the watermark needs a confirmation prompt.",
      hint: "Re-run with --force to remove it non-interactively.",
    });
    return {
      input: { library: lib.id },
      confirm: () =>
        confirm(
          `Remove the watermark from ${lib.name}? New uploads are encoded without it; existing videos keep theirs.`,
          { force: args.force },
        ),
    };
  },
  render: () => logger.success("Watermark removed."),
});

export const streamLibraryWatermarkNamespace = defineNamespace(
  "watermark",
  "Manage the watermark burned into a video library's new uploads.",
  [
    streamLibraryWatermarkShowCommand,
    streamLibraryWatermarkSetCommand,
    streamLibraryWatermarkRemoveCommand,
  ],
);
