import { deleteVideoCaption } from "@/commands/stream/caption-api.ts";
import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import type { VideoModel } from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import {
  confirm,
  isInteractive,
  prompts,
  requireConfirmable,
  withSpinner,
} from "@/core/ui.ts";
import { captionLanguage, languageRequired } from "./add.ts";

interface CaptionRemoveArgs {
  video?: string;
  lang?: string;
  lib?: string;
  force?: boolean;
}

const REMOVE_USAGE = "bunny stream captions remove <video> <lang>";

/**
 * The caption language to remove: the argument, else picked from the video's
 * caption tracks. Never prompts unattended or under --force.
 */
export async function captionLanguageToRemove(
  video: Pick<VideoModel, "title" | "captions">,
  lang: string | undefined,
  opts: { output?: OutputFormat; force?: boolean },
): Promise<string | undefined> {
  if (lang) return captionLanguage(lang);
  if (opts.force || !isInteractive(opts.output)) {
    throw languageRequired(REMOVE_USAGE);
  }

  const tracks = (video.captions ?? []).filter((c) => c.srclang);
  if (tracks.length === 0) {
    throw new UserError(`${video.title} has no captions to remove.`);
  }
  const { value } = await prompts({
    type: "select",
    name: "value",
    message: "Captions to remove:",
    choices: tracks.map((track) => ({
      title: track.label
        ? `${track.srclang} (${track.label})`
        : `${track.srclang}`,
      value: track.srclang,
    })),
  });
  return typeof value === "string" ? value : undefined;
}

export const streamCaptionRemoveCommand = defineCommand<CaptionRemoveArgs>({
  command: "remove [video] [lang]",
  aliases: ["delete", "rm"],
  describe: "Remove the captions for one language.",
  examples: [
    [
      "$0 stream captions remove 1a2b3c4d-... en",
      "Remove the English captions",
    ],
    ["$0 stream captions remove 1a2b3c4d-... en --force", "Skip confirmation"],
    ["$0 stream captions remove", "Pick the video, then the language"],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", {
        type: "string",
        describe:
          "Video GUID (see `bunny stream videos list`; prompts if omitted)",
      })
      .positional("lang", {
        type: "string",
        describe:
          "Language code of the captions to remove (prompts if omitted)",
      })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompt",
      }),

  handler: async ({
    video: ref,
    lang,
    lib,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    // Validate a given code before any network call.
    if (lang) captionLanguage(lang);
    else if (force || !isInteractive(output)) {
      throw languageRequired(REMOVE_USAGE);
    }

    // Destructive, so --force disables the library picker too.
    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      force,
    });

    const video = await resolveVideoInteractive(client, libraryId, ref, {
      output,
      force,
    });

    const srclang = await captionLanguageToRemove(video, lang, {
      output,
      force,
    });
    if (!srclang) {
      logger.log("Cancelled.");
      return;
    }

    requireConfirmable(output, {
      force,
      message: `Removing the ${srclang} captions needs a confirmation prompt.`,
      hint: "Re-run with --force to remove them non-interactively.",
    });
    const confirmed = await confirm(
      `Remove the ${srclang} captions from ${video.title}?`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    await withSpinner(`Removing ${srclang} captions...`, () =>
      deleteVideoCaption(client, libraryId, video.guid, srclang),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { id: video.guid, title: video.title, srclang, removed: true },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Removed the ${srclang} captions from ${video.title}.`);
  },
});
