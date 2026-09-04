import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamLibraryCreateCommand } from "./create.ts";
import { streamLibraryCredentialsCommand } from "./credentials.ts";
import { streamLibraryDeleteCommand } from "./delete.ts";
import { streamLibraryLinkCommand } from "./link.ts";
import { streamLibraryListCommand } from "./list.ts";
import { streamLibraryShowCommand } from "./show.ts";
import { streamLibraryUnlinkCommand } from "./unlink.ts";
import { streamLibraryUpdateCommand } from "./update.ts";

const subcommands: CommandModule[] = [
  streamLibraryListCommand,
  streamLibraryCreateCommand,
  streamLibraryShowCommand,
  streamLibraryUpdateCommand,
  streamLibraryCredentialsCommand,
  streamLibraryLinkCommand,
  streamLibraryUnlinkCommand,
  streamLibraryDeleteCommand,
];

export const streamLibraryNamespace = defineNamespace(
  "library",
  "Manage Stream video libraries.",
  subcommands,
  ["libraries", "lib"],
);
