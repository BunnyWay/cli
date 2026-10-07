import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamLibrarySecurityResetTokenCommand } from "./reset-token.ts";
import { streamLibrarySecurityShowCommand } from "./show.ts";
import { streamLibrarySecurityUpdateCommand } from "./update.ts";

const subcommands: CommandModule[] = [
  streamLibrarySecurityShowCommand,
  streamLibrarySecurityUpdateCommand,
  streamLibrarySecurityResetTokenCommand,
];

export const streamLibrarySecurityNamespace = defineNamespace(
  "security",
  "Manage a video library's security settings: tokens, domains, direct play, Basic DRM.",
  subcommands,
);
