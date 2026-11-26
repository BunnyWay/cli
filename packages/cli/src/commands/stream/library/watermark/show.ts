import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { streamWatermarkGet } from "@/tools/stream/index.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import { formatWatermark, libraryPositional } from "./render.ts";

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
