import { streamPlayerGet } from "@bunny.net/tools/stream";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import { formatPlayerSettings } from "./render.ts";

export const streamLibraryPlayerShowCommand = defineToolCommand({
  tool: streamPlayerGet,
  command: "show [library]",
  describe: "Show a video library's player settings.",
  examples: [
    ["$0 stream library player show my-library", "Show player settings"],
  ],
  progress: "Fetching player settings...",

  builder: (yargs) =>
    yargs.positional("library", {
      type: "string",
      describe: "Video library name or ID",
    }),

  prepare: async ({ library, output }, ctx) => {
    const lib = await resolveLibraryRef(ctx, library, { output });
    return { input: { library: lib.id } };
  },

  render: (player, { output }) => {
    logger.log(formatPlayerSettings(player, output));
  },
});
