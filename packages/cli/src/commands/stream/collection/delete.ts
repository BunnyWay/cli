import { deleteCollection } from "@/commands/stream/collection-api.ts";
import { streamLibraryContext } from "@/commands/stream/context.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import { resolveCollectionInteractive } from "./interactive.ts";

interface CollectionDeleteArgs {
  collection?: string;
  lib?: string;
  force?: boolean;
}

export const streamCollectionDeleteCommand =
  defineCommand<CollectionDeleteArgs>({
    command: "delete [collection]",
    aliases: ["rm", "remove"],
    describe: "Delete a collection, keeping its videos.",
    examples: [
      ["$0 stream collection delete 8a7b6c5d-...", "Delete a collection"],
      ["$0 stream collection delete 8a7b6c5d-... --force", "Skip confirmation"],
      ["$0 stream collection delete", "Pick a collection interactively"],
    ],

    builder: (yargs) =>
      yargs
        .positional("collection", { type: "string", describe: "Collection ID" })
        .option("lib", {
          alias: "library",
          type: "string",
          describe: "Video library ID (defaults to the linked library)",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          default: false,
          describe: "Skip confirmation prompt",
        }),

    handler: async ({
      collection: ref,
      lib,
      force,
      profile,
      output,
      verbose,
      apiKey,
    }) => {
      // Destructive, so --force disables both pickers instead of picking for you.
      const { client, libraryId } = await streamLibraryContext({
        lib,
        profile,
        output,
        verbose,
        apiKey,
        force,
      });

      const collection = await resolveCollectionInteractive(
        client,
        libraryId,
        ref,
        { output, force },
      );

      requireConfirmable(output, {
        force,
        message: `Deleting "${collection.name}" needs a confirmation prompt.`,
        hint: "Re-run with --force to delete non-interactively.",
      });
      const confirmed = await confirm(
        `Delete collection ${collection.name}? Its ${collection.videoCount ?? 0} video(s) are kept and simply leave the collection.`,
        { force },
      );
      if (!confirmed) {
        logger.log("Cancelled.");
        return;
      }

      await withSpinner("Deleting collection...", () =>
        deleteCollection(client, libraryId, collection.guid as string),
      );

      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              id: collection.guid,
              name: collection.name,
              removed: true,
              videosKept: collection.videoCount ?? 0,
            },
            null,
            2,
          ),
        );
        return;
      }

      logger.success(`Deleted collection ${collection.name}.`);
      logger.dim("Its videos were kept.");
    },
  });
