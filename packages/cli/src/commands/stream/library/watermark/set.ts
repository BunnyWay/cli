import { stat } from "node:fs/promises";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { streamWatermarkSet } from "@/tools/stream/index.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import {
  APPLIES_TO_NEW,
  formatWatermark,
  libraryPositional,
} from "./render.ts";

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
