import { nameArg } from "@/commands/stream/name-arg.ts";
import { defineCommand } from "@/core/define-command.ts";
import { runCollectionUpdate } from "./update.ts";

interface CollectionRenameArgs {
  collection?: string;
  newName?: string;
  lib?: string;
  name?: string;
}

// Hidden: the old spelling of `collections update`, kept with its original arguments.
export const streamCollectionRenameCommand =
  defineCommand<CollectionRenameArgs>({
    command: "rename [collection] [new-name]",
    describe: "Rename a collection.",
    hidden: true,

    builder: (yargs) =>
      yargs
        .positional("collection", { type: "string", describe: "Collection ID" })
        .positional("new-name", {
          type: "string",
          describe: "New collection name (or use --name)",
        })
        .option("lib", {
          alias: "library",
          type: "string",
          describe: "Video library ID (defaults to the linked library)",
        })
        .option("name", {
          type: "string",
          describe: "New collection name",
        }),

    handler: ({ newName, name, ...args }) =>
      runCollectionUpdate({ ...args, name: nameArg(newName, name) }),
  });
