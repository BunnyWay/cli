import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamEncodeEnableCommand } from "./enable.ts";
import { streamEncodeReencodeCommand } from "./reencode.ts";

const subcommands: CommandModule[] = [
  streamEncodeEnableCommand,
  streamEncodeReencodeCommand,
];

export const streamEncodeNamespace = defineNamespace(
  "encode",
  "Premium encoding: enable it on a library, or re-encode a video.",
  subcommands,
);
