import { createCollection } from "@/commands/stream/collection-api.ts";
import { streamLibraryContext } from "@/commands/stream/context.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";

interface CollectionCreateArgs {
  collectionName?: string;
  name?: string;
  lib?: string;
}

/**
 * The name for the new collection, from the positional or `--name`.
 *
 * Both are accepted; giving both with different values is a mistake worth
 * reporting rather than silently picking a winner.
 */
export function collectionName(
  positional: string | undefined,
  flag: string | undefined,
): string | undefined {
  const fromPositional = positional?.trim();
  const fromFlag = flag?.trim();

  if (fromPositional && fromFlag && fromPositional !== fromFlag) {
    throw new UserError(
      `Conflicting names: "${fromPositional}" and --name "${fromFlag}".`,
      "Pass the name once, either as the argument or as --name.",
    );
  }
  return fromFlag || fromPositional || undefined;
}

export const streamCollectionCreateCommand =
  defineCommand<CollectionCreateArgs>({
    command: "create [collection-name]",
    aliases: ["add"],
    describe: "Create a collection in a Stream video library.",
    examples: [
      ["$0 stream collection create --name Tutorials", "Create a collection"],
      ["$0 stream collection create Tutorials", "Same, as a positional"],
      [
        "$0 stream collection create Tutorials --lib 12345",
        "Create it in a specific library",
      ],
    ],

    builder: (yargs) =>
      yargs
        .positional("collection-name", {
          type: "string",
          describe: "Name for the new collection",
        })
        .option("name", {
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
      let wanted = collectionName(args.collectionName, args.name);

      // Fail on a missing name before any API call, since an unattended run has
      // no way to supply one later.
      if (!wanted && !isInteractive(output)) {
        throw new UserError(
          "A collection name is required.",
          "Pass the name: bunny stream collection create --name Tutorials",
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
          "Pass the name: bunny stream collection create --name Tutorials",
        );
      }

      const collection = await withSpinner(
        `Creating collection ${wanted}...`,
        () => createCollection(client, libraryId, wanted as string),
      );

      if (output === "json") {
        logger.log(JSON.stringify(collection, null, 2));
        return;
      }

      logger.success(
        `Created collection ${collection.name} in ${library.Name}.`,
      );
      logger.log(`ID: ${collection.guid}`);
      logger.dim(
        "Put videos in it with `bunny stream video upload --collection <id>` or `video update --collection <id>`.",
      );
    },
  });
