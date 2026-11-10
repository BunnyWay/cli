import type { CommandModule } from "yargs";
import { streamVideoEncodeCommand } from "@/commands/stream/video/encode.ts";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamEncodeEnableCommand } from "./enable.ts";

// Hidden: `encode enable` is now `libraries update --encoding-tier premium`, and
// `encode reencode` is `videos encode`. Both old spellings keep working.
const subcommands: CommandModule[] = [
  streamEncodeEnableCommand,
  { ...streamVideoEncodeCommand, command: "reencode [video]", aliases: [] },
];

export const streamEncodeNamespace = defineNamespace(
  "encode",
  false,
  subcommands,
);
