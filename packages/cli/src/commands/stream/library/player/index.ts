import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamLibraryPlayerResetCommand } from "./reset.ts";
import { streamLibraryPlayerShowCommand } from "./show.ts";
import { streamLibraryPlayerUpdateCommand } from "./update.ts";

const subcommands: CommandModule[] = [
  streamLibraryPlayerShowCommand,
  streamLibraryPlayerUpdateCommand,
  streamLibraryPlayerResetCommand,
];

export const streamLibraryPlayerNamespace = defineNamespace(
  "player",
  "Manage a video library's Bunny Player settings.",
  subcommands,
);
