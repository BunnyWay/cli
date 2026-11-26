import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamLibraryWatermarkRemoveCommand } from "./remove.ts";
import { streamLibraryWatermarkSetCommand } from "./set.ts";
import { streamLibraryWatermarkShowCommand } from "./show.ts";

const subcommands: CommandModule[] = [
  streamLibraryWatermarkShowCommand,
  streamLibraryWatermarkSetCommand,
  streamLibraryWatermarkRemoveCommand,
];

export const streamLibraryWatermarkNamespace = defineNamespace(
  "watermark",
  "Manage the watermark burned into a video library's new uploads.",
  subcommands,
);
