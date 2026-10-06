import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamCollectionCreateCommand } from "./create.ts";
import { streamCollectionDeleteCommand } from "./delete.ts";
import { streamCollectionListCommand } from "./list.ts";
import { streamCollectionRenameCommand } from "./rename.ts";
import { streamCollectionShowCommand } from "./show.ts";

const subcommands: CommandModule[] = [
  streamCollectionListCommand,
  streamCollectionCreateCommand,
  streamCollectionShowCommand,
  streamCollectionRenameCommand,
  streamCollectionDeleteCommand,
];

export const streamCollectionNamespace = defineNamespace(
  "collection",
  "Group a library's videos into collections.",
  subcommands,
  ["collections"],
);
