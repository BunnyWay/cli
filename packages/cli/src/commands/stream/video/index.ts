import type { CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { streamVideoCleanupCommand } from "./cleanup.ts";
import { streamVideoDeleteCommand } from "./delete.ts";
import { streamVideoFetchCommand } from "./fetch.ts";
import { streamVideoListCommand } from "./list.ts";
import { streamVideoResolutionsCommand } from "./resolutions.ts";
import { streamVideoShowCommand } from "./show.ts";
import { streamVideoStatsCommand } from "./stats.ts";
import { streamVideoThumbnailCommand } from "./thumbnail.ts";
import { streamVideoUpdateCommand } from "./update.ts";
import { streamVideoUploadCommand } from "./upload.ts";

const subcommands: CommandModule[] = [
  streamVideoListCommand,
  streamVideoShowCommand,
  streamVideoUploadCommand,
  streamVideoFetchCommand,
  streamVideoUpdateCommand,
  streamVideoThumbnailCommand,
  streamVideoResolutionsCommand,
  streamVideoCleanupCommand,
  streamVideoStatsCommand,
  streamVideoDeleteCommand,
];

export const streamVideoNamespace = defineNamespace(
  "video",
  "Manage the videos in a Stream video library.",
  subcommands,
  ["videos"],
);
