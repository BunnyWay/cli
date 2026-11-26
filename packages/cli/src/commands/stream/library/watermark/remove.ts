import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable } from "@/core/ui.ts";
import { streamWatermarkRemove } from "@/tools/stream/index.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import { libraryPositional } from "./render.ts";

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
