import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamLibraryGeoCountriesCommand } from "./countries.ts";
import { streamLibraryGeoPresetsCommand } from "./presets.ts";
import { streamLibraryGeoShowCommand } from "./show.ts";
import { streamLibraryGeoUpdateCommand } from "./update.ts";

const subcommands: CommandModule[] = [
  streamLibraryGeoShowCommand,
  streamLibraryGeoUpdateCommand,
  streamLibraryGeoCountriesCommand,
  streamLibraryGeoPresetsCommand,
];

export const streamLibraryGeoBlockingNamespace = defineNamespace(
  "geo-blocking",
  "Block or allow countries from watching a video library's videos.",
  subcommands,
  ["geoblocking", "geo"],
);
