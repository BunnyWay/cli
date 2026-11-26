import { defineToolCommand } from "@/core/define-tool-command.ts";
import { streamGeoBlockingGet } from "@/tools/stream/index.ts";
import { resolveLibraryRef } from "../library-ref.ts";
import { libraryPositional, renderGeoBlocking } from "./render.ts";

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
