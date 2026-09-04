import { createCoreClient } from "@bunny.net/openapi-client";
import {
  STREAM_MANIFEST,
  type StreamLibraryManifest,
} from "@/commands/stream/constants.ts";
import { resolveLibraryInteractive } from "@/commands/stream/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, removeManifest } from "@/core/manifest.ts";
import { confirm, requireConfirmable, spinner } from "@/core/ui.ts";

interface LibraryDeleteArgs {
  library?: string;
  force?: boolean;
}

export const streamLibraryDeleteCommand = defineCommand<LibraryDeleteArgs>({
  command: "delete [library]",
  aliases: ["rm", "remove"],
  describe: "Delete a Stream video library and all of its videos.",
  examples: [
    ["$0 stream library delete my-library", "Delete a video library"],
    ["$0 stream library delete my-library --force", "Skip confirmation"],
    ["$0 stream library delete", "Pick a library interactively"],
  ],

  builder: (yargs) =>
    yargs
      .positional("library", {
        type: "string",
        describe: "Video library name or ID",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompt",
      }),

  handler: async ({ library, force, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // Destructive: --force must not silently delete a picked library, so it disables the picker.
    const lib = await resolveLibraryInteractive(client, library, {
      output,
      force,
    });

    requireConfirmable(output, {
      force,
      message: `Deleting "${lib.Name}" needs a confirmation prompt.`,
      hint: "Re-run with --force to delete non-interactively.",
    });
    const confirmed = await confirm(
      `Delete video library ${lib.Name} and all ${lib.VideoCount ?? 0} video(s)? This cannot be undone.`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const removeSpin = spinner("Deleting video library...");
    removeSpin.start();
    try {
      await client.DELETE("/videolibrary/{id}", {
        params: { path: { id: lib.Id as number } },
      });
    } finally {
      removeSpin.stop();
    }

    // Drop a manifest that pointed at the deleted library so later commands don't resolve a ghost.
    const manifest = loadManifest<StreamLibraryManifest>(STREAM_MANIFEST);
    const unlinked = manifest.id === lib.Id;
    if (unlinked) removeManifest(STREAM_MANIFEST);

    if (output === "json") {
      logger.log(
        JSON.stringify({ id: lib.Id, name: lib.Name, removed: true }, null, 2),
      );
      return;
    }

    logger.success(`Deleted video library ${lib.Name}.`);
    if (unlinked) logger.dim(`Removed stale .bunny/${STREAM_MANIFEST}.`);
  },
});
