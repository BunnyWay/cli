import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamCaptionAddCommand } from "./add.ts";
import { streamCaptionDeleteCommand } from "./delete.ts";

const subcommands: CommandModule[] = [
  streamCaptionAddCommand,
  streamCaptionDeleteCommand,
];

export const streamCaptionNamespace = defineNamespace(
  "caption",
  "Upload and remove caption files for a video.",
  subcommands,
  ["captions"],
);
