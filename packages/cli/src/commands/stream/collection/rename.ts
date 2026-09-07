import {
  fetchCollection,
  renameCollection,
} from "@/commands/stream/collection-api.ts";
import { streamLibraryContext } from "@/commands/stream/context.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import { resolveCollectionInteractive } from "./interactive.ts";

interface CollectionRenameArgs {
  collection?: string;
  lib?: string;
  name?: string;
}

/**
 * The new collection name, or undefined when the prompt was cancelled or blank.
 *
 * The name is the only mutable field, so an unattended run without `--name` has
 * nothing to do and says so.
 */
export async function nextCollectionName(
  current: string,
  name: string | undefined,
  interactive: boolean,
): Promise<string | undefined> {
  const explicit = name?.trim();
  if (explicit) return explicit;

  if (!interactive) {
    throw new UserError(
      "Nothing to rename.",
      "Pass --name to set the new collection name.",
    );
  }

  const { value } = await prompts({
    type: "text",
    name: "value",
    message: "Collection name:",
    initial: current,
  });
  return (value as string | undefined)?.trim() || undefined;
}

export const streamCollectionRenameCommand =
  defineCommand<CollectionRenameArgs>({
    command: "rename [collection]",
    describe: "Rename a collection.",
    examples: [
      [
        "$0 stream collection rename 8a7b6c5d-... --name Tutorials",
        "Rename a collection",
      ],
      ["$0 stream collection rename", "Pick a collection, then edit its name"],
    ],

    builder: (yargs) =>
      yargs
        .positional("collection", { type: "string", describe: "Collection ID" })
        .option("lib", {
          alias: "library",
          type: "string",
          describe: "Video library ID (defaults to the linked library)",
        })
        .option("name", {
          type: "string",
          describe: "New collection name (prompts if omitted)",
        }),

    handler: async ({
      collection: ref,
      lib,
      name,
      profile,
      output,
      verbose,
      apiKey,
    }) => {
      const { client, libraryId } = await streamLibraryContext({
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

      const wanted = await nextCollectionName(
        collection.name ?? "",
        name,
        isInteractive(output),
      );
      if (wanted === undefined) {
        logger.log("Cancelled.");
        return;
      }
      if (wanted === collection.name) {
        if (output === "json") {
          logger.log(JSON.stringify(collection, null, 2));
          return;
        }
        logger.log("Name unchanged.");
        return;
      }

      const guid = collection.guid as string;
      await withSpinner("Renaming collection...", () =>
        renameCollection(client, libraryId, guid, wanted),
      );

      // The update endpoint answers with a status, so read the collection back.
      const updated = await withSpinner("Reading collection...", () =>
        fetchCollection(client, libraryId, guid),
      );

      if (output === "json") {
        logger.log(JSON.stringify(updated, null, 2));
        return;
      }
      logger.success(`Renamed ${collection.name} to ${updated.name}.`);
    },
  });
