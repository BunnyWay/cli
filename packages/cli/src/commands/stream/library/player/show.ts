import { defineToolCommand } from "@/core/define-tool-command.ts";
import { logger } from "@/core/logger.ts";
import { streamPlayerGet } from "@/tools/stream/index.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import { formatPlayerSettings, safePlayerSettings } from "./render.ts";

export const streamLibraryPlayerShowCommand = defineToolCommand({
  tool: streamPlayerGet,
  command: "show [library]",
  describe: "Show a video library's player settings.",
  examples: [
    ["$0 stream libraries player show my-library", "Show player settings"],
    ["$0 stream libraries player show", "Use the linked library"],
    ["$0 stream libraries player show my-library --output json", "JSON output"],
    [
      "$0 stream libraries player show my-library --show-secret",
      "Show the VAST URL in full",
    ],
  ],
  progress: "Fetching player settings...",

  builder: (yargs) =>
    yargs
      .positional("library", {
        type: "string",
        describe: "Video library name or ID",
      })
      .option("show-secret", {
        type: "boolean",
        default: false,
        describe:
          "Show the VAST URL in full (its query string and userinfo are redacted by default)",
      }),

  prepare: async ({ library, output }, ctx) => {
    const lib = await resolveLibraryRef(ctx, library, { output });
    return { input: { library: lib.id } };
  },

  json: (player, args) => safePlayerSettings(player, args["show-secret"]),

  render: (player, args) => {
    logger.log(formatPlayerSettings(player, args.output, args["show-secret"]));
  },
});
