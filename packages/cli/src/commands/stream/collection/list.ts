import { fetchCollections } from "@/commands/stream/collection-api.ts";
import { streamLibraryContext } from "@/commands/stream/context.ts";
import { defineCommand } from "@/core/define-command.ts";
import { formatBytes, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface CollectionListArgs {
  lib?: string;
  search?: string;
}

export const streamCollectionListCommand = defineCommand<CollectionListArgs>({
  command: "list",
  aliases: ["ls"],
  describe: "List the collections in a Stream video library.",
  examples: [
    ["$0 stream collection list", "List collections in the linked library"],
    ["$0 stream collection list --lib 12345", "List a specific library's"],
    ["$0 stream collection list --search tutorial", "Filter by name"],
  ],

  builder: (yargs) =>
    yargs
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("search", {
        type: "string",
        describe: "Only list collections matching this search term",
      }),

  handler: async ({ lib, search, profile, output, verbose, apiKey }) => {
    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });

    const collections = await withSpinner("Fetching collections...", () =>
      fetchCollections(client, libraryId, { search }),
    );

    if (output === "json") {
      logger.log(JSON.stringify(collections, null, 2));
      return;
    }

    if (collections.length === 0) {
      logger.info("No collections found.");
      logger.dim(
        "Create one with `bunny stream collection create --name <name>`.",
      );
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Videos", "Size"],
        collections.map((collection) => [
          collection.guid ?? "",
          collection.name ?? "",
          String(collection.videoCount ?? 0),
          formatBytes(collection.totalSize ?? 0),
        ]),
        output,
      ),
    );
  },
});
