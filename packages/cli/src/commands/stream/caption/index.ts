import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamCaptionAddCommand } from "./add.ts";
import { streamCaptionRemoveCommand } from "./remove.ts";

const subcommands: CommandModule[] = [
  streamCaptionAddCommand,
  streamCaptionRemoveCommand,
];

export const streamCaptionNamespace = defineNamespace(
  "captions",
  "Upload and remove caption files for a video.",
  subcommands,
  ["caption"],
);
