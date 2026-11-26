import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import {
  formatBytes,
  formatDateTime,
  formatKeyValue,
  formatTable,
} from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import type { OutputFormat } from "@/core/types.ts";
import { withSpinner } from "@/core/ui.ts";
import { streamVideoStorage, type VideoStorage } from "@/tools/stream/index.ts";

interface VideoStorageArgs {
  video?: string;
  lib?: string;
}

export function formatVideoStorage(
  storage: VideoStorage,
  output: OutputFormat,
): string {
  const summary = formatKeyValue(
    [
      { key: "Total", value: formatBytes(storage.totalBytes) },
      {
        key: "Encoded renditions",
        value: formatBytes(
          storage.renditions.reduce((sum, r) => sum + r.bytes, 0),
        ),
      },
      { key: "Original", value: formatBytes(storage.originalBytes) },
      { key: "MP4 fallback", value: formatBytes(storage.mp4FallbackBytes) },
      { key: "Thumbnails", value: formatBytes(storage.thumbnailBytes) },
      { key: "Previews", value: formatBytes(storage.previewBytes) },
      { key: "Other", value: formatBytes(storage.otherBytes) },
      {
        key: "Calculated",
        value: storage.calculatedAt
          ? formatDateTime(storage.calculatedAt)
          : "-",
      },
    ],
    output,
  );
  if (storage.renditions.length === 0) return summary;
  const renditions = formatTable(
    ["Resolution", "Codec", "Size"],
    storage.renditions.map((r) => [
      r.resolution,
      r.codec,
      formatBytes(r.bytes),
    ]),
    output,
  );
  return `${summary}\n\nRenditions:\n${renditions}`;
}

export const streamVideoStorageCommand = defineCommand<VideoStorageArgs>({
  command: "storage [video]",
  aliases: ["size"],
  describe:
    "Show how much storage a video uses: each rendition, the original, MP4 fallback, thumbnails and previews.",
  examples: [
    ["$0 stream videos storage 1a2b3c4d-...", "Storage breakdown"],
    ["$0 stream videos storage", "Pick a video interactively"],
    ["$0 stream videos storage 1a2b3c4d-... --output json", "JSON output"],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", { type: "string", describe: "Video GUID" })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      }),

  handler: async ({ video: ref, lib, profile, output, verbose, apiKey }) => {
    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      offerLink: true,
    });
    const video = await resolveVideoInteractive(client, libraryId, ref, {
      output,
    });
    const ctx = toolContext(resolveConfig(profile, apiKey, verbose), {
      verbose,
    });
    const storage = await withSpinner("Measuring storage...", () =>
      streamVideoStorage.invoke(ctx, {
        library: libraryId,
        video: video.guid,
      }),
    );

    if (output === "json") {
      logger.log(JSON.stringify(storage, null, 2));
      return;
    }
    logger.log(`${video.title} (${video.guid})`);
    logger.log(formatVideoStorage(storage, output));
  },
});
