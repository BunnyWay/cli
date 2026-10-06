import { streamLibraryContext } from "@/commands/stream/context.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatBytes, formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { resolveCollectionInteractive } from "./interactive.ts";

interface CollectionShowArgs {
  collection?: string;
  lib?: string;
}

export const streamCollectionShowCommand = defineCommand<CollectionShowArgs>({
  command: "show [collection]",
  describe: "Show details for a collection.",
  examples: [
    ["$0 stream collection show 8a7b6c5d-...", "Show a collection by ID"],
    ["$0 stream collection show", "Pick a collection interactively"],
    [
      "$0 stream collection show 8a7b6c5d-... --output json",
      "JSON output (includes preview image URLs)",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("collection", { type: "string", describe: "Collection ID" })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      }),

  handler: async ({
    collection: ref,
    lib,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const { client, library, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });

    const collection = await resolveCollectionInteractive(
      client,
      libraryId,
      ref,
      { output },
    );

    if (output === "json") {
      logger.log(JSON.stringify(collection, null, 2));
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "ID", value: collection.guid ?? "" },
          { key: "Name", value: collection.name ?? "" },
          { key: "Videos", value: String(collection.videoCount ?? 0) },
          { key: "Size", value: formatBytes(collection.totalSize ?? 0) },
          {
            key: "Library",
            value: `${library.Name ?? ""} (${collection.videoLibraryId ?? libraryId})`,
          },
        ],
        output,
      ),
    );
    logger.dim(
      `List its videos with \`bunny stream video list --collection ${collection.guid}\`.`,
    );
  },
});
