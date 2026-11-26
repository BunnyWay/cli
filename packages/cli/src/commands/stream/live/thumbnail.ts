import { stat } from "node:fs/promises";
import { thumbnailSource } from "@/commands/stream/video/thumbnail.ts";
import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import {
  streamLiveThumbnailRemove,
  streamLiveThumbnailSet,
} from "@/tools/stream/index.ts";
import {
  LIVE_PREVIEW_EPILOGUE,
  resolveLiveTarget,
  withStreamPositional,
} from "./shared.ts";

interface LiveThumbnailArgs {
  stream?: string;
  lib?: string;
  url?: string;
  file?: string;
  remove?: boolean;
  restoreDefault?: boolean;
  force?: boolean;
}

export const streamLiveThumbnailCommand = defineCommand<LiveThumbnailArgs>({
  command: "thumbnail [stream]",
  describe: "Set or remove a live stream's thumbnail image.",
  examples: [
    [
      "$0 stream live thumbnail 0f4e5d6c-... --file ./poster.jpg",
      "Upload a local image",
    ],
    [
      "$0 stream live thumbnail 0f4e5d6c-... --url https://example.com/poster.jpg",
      "Have bunny.net download the image",
    ],
    [
      "$0 stream live thumbnail 0f4e5d6c-... --remove",
      "Back to the library default (confirms first)",
    ],
    [
      "$0 stream live thumbnail 0f4e5d6c-... --remove --force",
      "Remove it without the confirmation",
    ],
  ],
  epilogue: LIVE_PREVIEW_EPILOGUE,

  builder: (yargs) =>
    withStreamPositional(yargs)
      .option("file", { type: "string", describe: "Local image to upload" })
      .option("url", {
        type: "string",
        describe: "Public image URL for bunny.net to download",
      })
      .option("remove", {
        type: "boolean",
        default: false,
        describe: "Remove the custom thumbnail",
      })
      .option("restore-default", {
        type: "boolean",
        default: true,
        describe:
          "With --remove, fall back to the library's default live thumbnail (--no-restore-default for none)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "With --remove, skip the confirmation prompt",
      }),

  preRun: async ({ remove, url, file }) => {
    if (remove && (url || file))
      throw new UserError("Pass --remove on its own, without --file or --url.");
    if (!remove) thumbnailSource(url, file);
  },

  handler: async (args) => {
    const { profile, apiKey, verbose, output } = args;
    const ctx = toolContext(resolveConfig(profile, apiKey, verbose), {
      verbose,
    });
    const { library, streamId } = await resolveLiveTarget(ctx, args);
    const target = { library: library.id, stream: streamId };

    let result: Awaited<ReturnType<typeof streamLiveThumbnailSet.invoke>>;
    if (args.remove) {
      // The custom image is deleted for good, so this confirms like the other irreversible live commands.
      requireConfirmable(output, {
        force: args.force,
        message:
          "Removing a live stream thumbnail needs a confirmation prompt.",
        hint: "Re-run with --force to remove it non-interactively.",
      });
      const confirmed = await confirm(
        "Remove this live stream's custom thumbnail? The image can't be restored.",
        { force: args.force },
      );
      if (!confirmed) {
        logger.log("Cancelled.");
        return;
      }
      result = await withSpinner("Removing thumbnail...", () =>
        streamLiveThumbnailRemove.invoke(ctx, {
          ...target,
          restoreDefault: args.restoreDefault ?? true,
        }),
      );
    } else {
      const source = thumbnailSource(args.url, args.file);
      if ("file" in source) {
        const info = await stat(source.file).catch(() => null);
        if (!info?.isFile()) throw new UserError(`Not a file: ${source.file}`);
      }
      result = await withSpinner("Setting thumbnail...", () =>
        streamLiveThumbnailSet.invoke(ctx, { ...target, ...source }),
      );
    }

    if (output === "json") {
      logger.log(JSON.stringify(result, null, 2));
      return;
    }
    logger.success(
      result.thumbnail === "set" ? "Thumbnail set." : "Thumbnail removed.",
    );
  },
});
