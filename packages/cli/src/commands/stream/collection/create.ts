import { createCollection } from "@/commands/stream/collection-api.ts";
import { streamLibraryContext } from "@/commands/stream/context.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { track } from "@/core/telemetry.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";

interface CollectionCreateArgs {
  name?: string;
  lib?: string;
}

export const streamCollectionCreateCommand =
  defineCommand<CollectionCreateArgs>({
    command: "create [name]",
    aliases: ["add"],
    describe: "Create a collection in a Stream video library.",
    examples: [
      ["$0 stream collections create Tutorials", "Create a collection"],
      ["$0 stream collections create", "Interactive: prompts for the name"],
      [
        "$0 stream collections create Tutorials --lib 12345",
        "Create it in a specific library",
      ],
    ],

    builder: (yargs) =>
      yargs
        .positional("name", {
          type: "string",
          describe: "Name for the new collection",
        })
        .option("lib", {
          alias: "library",
          type: "string",
          describe: "Video library ID (defaults to the linked library)",
        }),

    handler: async (args) => {
      const { lib, profile, output, verbose, apiKey } = args;
      let wanted = args.name?.trim() || undefined;

      // Fail on a missing name before any API call, since an unattended run has
      // no way to supply one later.
      if (!wanted && !isInteractive(output)) {
        throw new UserError(
          "A collection name is required.",
          "Pass the name: bunny stream collections create Tutorials",
        );
      }

      const { client, library, libraryId } = await streamLibraryContext({
        lib,
        profile,
        output,
        verbose,
        apiKey,
        offerLink: true,
      });

      if (!wanted && isInteractive(output)) {
        const { value } = await prompts({
          type: "text",
          name: "value",
          message: "Name for the new collection:",
        });
        wanted = typeof value === "string" ? value.trim() : undefined;
      }
      if (!wanted) {
        throw new UserError(
          "A collection name is required.",
          "Pass the name: bunny stream collections create Tutorials",
        );
      }

      const collection = await withSpinner(
        `Creating collection ${wanted}...`,
        () => createCollection(client, libraryId, wanted as string),
      );
      track("stream_collection", { action: "create" });

      if (output === "json") {
        logger.log(JSON.stringify(collection, null, 2));
        return;
      }

      logger.success(
        `Created collection ${collection.name} in ${library.Name}.`,
      );
      logger.log(`ID: ${collection.guid}`);
      logger.dim(
        "Put videos in it with `bunny stream videos upload --collection <id>` or `videos update --collection <id>`.",
      );
    },
  });
