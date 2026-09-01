import type { CommandModule } from "yargs";
import { defineNamespace } from "../../../core/define-namespace.ts";
import { streamVideoDeleteCommand } from "./delete.ts";
import { streamVideoListCommand } from "./list.ts";
import { streamVideoShowCommand } from "./show.ts";
import { streamVideoUpdateCommand } from "./update.ts";

const subcommands: CommandModule[] = [
  streamVideoListCommand,
  streamVideoShowCommand,
  streamVideoUpdateCommand,
  streamVideoDeleteCommand,
];

export const streamVideoNamespace = defineNamespace(
  "videos",
  "Manage the videos in a Stream video library (add one with `bunny stream upload`).",
  subcommands,
  ["video"],
);
