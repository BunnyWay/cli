import { resolveLibraryRef } from "@/commands/stream/library/library-ref.ts";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import {
  formatBytes,
  formatDateTime,
  formatKeyValue,
  formatTable,
} from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { streamVideoStorage, type VideoStorage } from "@/tools/stream/index.ts";
import { resolveVideoRef } from "./video-ref.ts";

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

export const streamVideoStorageCommand = defineToolCommand({
  tool: streamVideoStorage,
  command: "storage [video]",
  aliases: ["size"],
  describe:
    "Show how much storage a video uses: each rendition, the original, MP4 fallback, thumbnails and previews.",
  examples: [
    ["$0 stream videos storage 1a2b3c4d-...", "Storage breakdown"],
    ["$0 stream videos storage", "Pick a video interactively"],
    ["$0 stream videos storage 1a2b3c4d-... --output json", "JSON output"],
  ],
  progress: "Measuring storage...",

  builder: (yargs) =>
    yargs
      .positional("video", { type: "string", describe: "Video GUID" })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library name or ID (defaults to the linked library)",
      }),

  prepare: async ({ video, lib, output }, ctx) => {
    const library = await resolveLibraryRef(ctx, lib, {
      output,
      offerLink: true,
    });
    const guid = await resolveVideoRef(ctx, library.id, video, { output });
    return { input: { library: library.id, video: guid } };
  },

  render: (storage, { output }) => {
    logger.log(`${storage.title ?? storage.video} (${storage.video})`);
    logger.log(formatVideoStorage(storage, output));
  },
});
