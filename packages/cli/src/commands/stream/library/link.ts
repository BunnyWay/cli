import { createCoreClient } from "@bunny.net/openapi-client";
import {
  resolveLibraryInteractive,
  writeStreamManifest,
} from "@/commands/stream/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";

interface LinkArgs {
  library?: string;
}

export const streamLibraryLinkCommand = defineCommand<LinkArgs>({
  command: "link [library]",
  describe: "Link the current directory to a Stream video library.",
  examples: [
    ["$0 stream library link", "Interactive selection"],
    ["$0 stream library link my-library", "Direct link by name or ID"],
  ],

  builder: (yargs) =>
    yargs.positional("library", {
      type: "string",
      describe: "Video library name or ID",
    }),

  handler: async ({ library: ref, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // Always re-pick: linking is how the manifest changes, so the existing one must not short-circuit.
    const lib = await resolveLibraryInteractive(client, ref, {
      output,
      ignoreManifest: true,
    });
    writeStreamManifest(lib);

    if (output === "json") {
      logger.log(JSON.stringify({ id: lib.Id, name: lib.Name }));
      return;
    }

    logger.success(`Linked to ${lib.Name} (${lib.Id}).`);
  },
});
