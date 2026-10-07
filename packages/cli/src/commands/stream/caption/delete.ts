import { deleteVideoCaption } from "@/commands/stream/caption-api.ts";
import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import { captionLanguage } from "./add.ts";

interface CaptionDeleteArgs {
  video: string;
  lang: string;
  lib?: string;
  force?: boolean;
}

export const streamCaptionDeleteCommand = defineCommand<CaptionDeleteArgs>({
  command: "delete <video> <lang>",
  aliases: ["rm", "remove"],
  describe: "Delete the captions for one language.",
  examples: [
    ["$0 stream caption delete 1a2b3c4d-... en", "Delete the English captions"],
    ["$0 stream caption delete 1a2b3c4d-... en --force", "Skip confirmation"],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", {
        type: "string",
        describe: "Video GUID (see `bunny stream video list`)",
        demandOption: true,
      })
      .positional("lang", {
        type: "string",
        describe: "Language code of the captions to delete",
        demandOption: true,
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
    const srclang = captionLanguage(lang);

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

    requireConfirmable(output, {
      force,
      message: `Deleting the ${srclang} captions needs a confirmation prompt.`,
      hint: "Re-run with --force to delete non-interactively.",
    });
    const confirmed = await confirm(
      `Delete the ${srclang} captions from ${video.title}?`,
      { force },
    );
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    await withSpinner(`Deleting ${srclang} captions...`, () =>
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

    logger.success(`Deleted the ${srclang} captions from ${video.title}.`);
  },
});
