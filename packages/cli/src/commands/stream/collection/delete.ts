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

/**
 * The confirmation question for a collection deletion.
 *
 * The API cascade-deletes a collection's videos, so the prompt names the count
 * that is about to go with it rather than implying the videos survive.
 */
export function collectionDeleteQuestion(
  name: string | null | undefined,
  videoCount: number | undefined,
): string {
  return `Delete collection ${name} and the ${videoCount ?? 0} video(s) inside it? This cannot be undone.`;
}

export const streamCollectionDeleteCommand =
  defineCommand<CollectionDeleteArgs>({
    command: "delete [collection]",
    aliases: ["rm", "remove"],
    describe: "Delete a collection and the videos inside it.",
    examples: [
      [
        "$0 stream collection delete 8a7b6c5d-...",
        "Delete a collection and its videos",
      ],
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

      const videoCount = collection.videoCount ?? 0;

      requireConfirmable(output, {
        force,
        message: `Deleting "${collection.name}" and the ${videoCount} video(s) inside it needs a confirmation prompt.`,
        hint: "Re-run with --force to delete non-interactively.",
      });
      const confirmed = await confirm(
        collectionDeleteQuestion(collection.name, collection.videoCount),
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
              videosDeleted: videoCount,
            },
            null,
            2,
          ),
        );
        return;
      }

      logger.success(`Deleted collection ${collection.name}.`);
      if (videoCount > 0) {
        logger.dim(`The ${videoCount} video(s) inside it were deleted too.`);
      }
    },
  });
