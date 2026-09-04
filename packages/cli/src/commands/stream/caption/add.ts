import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { addVideoCaption } from "@/commands/stream/caption-api.ts";
import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";

interface CaptionAddArgs {
  video: string;
  lang: string;
  lib?: string;
  label?: string;
  file: string;
}

/** Caption formats bunny.net accepts; anything else is almost certainly a mistake. */
const CAPTION_EXTENSIONS = [".vtt", ".srt"];

/** Normalize a language code the way the API's srclang path segment expects. */
export function captionLanguage(lang: string): string {
  const code = lang.trim().toLowerCase();
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(code)) {
    throw new UserError(
      `Invalid language code "${lang}".`,
      "Use an ISO 639-1 code, optionally with a region (e.g. en, de, pt-br).",
    );
  }
  return code;
}

/**
 * Read a caption file and base64 it for the JSON body.
 *
 * Validated first: the API takes the bytes inline, so a missing or wrong-typed
 * file should fail here rather than as a rejected upload.
 */
export async function readCaptionFile(file: string): Promise<string> {
  const entry = await stat(file).catch(() => null);
  if (!entry) throw new UserError(`Caption file not found: ${file}`);
  if (!entry.isFile()) {
    throw new UserError(`${file} is not a regular file.`);
  }
  if (!CAPTION_EXTENSIONS.includes(extname(file).toLowerCase())) {
    throw new UserError(
      `${file} does not look like a caption file.`,
      `Expected one of: ${CAPTION_EXTENSIONS.join(", ")}.`,
    );
  }
  if (entry.size === 0) throw new UserError(`${file} is empty.`);

  return Buffer.from(await Bun.file(file).arrayBuffer()).toString("base64");
}

export const streamCaptionAddCommand = defineCommand<CaptionAddArgs>({
  command: "add <video> <lang>",
  aliases: ["upload"],
  describe: "Upload a caption file for one language.",
  examples: [
    [
      "$0 stream caption add 1a2b3c4d-... en --file ./captions.vtt",
      "Add English captions",
    ],
    [
      '$0 stream caption add 1a2b3c4d-... de --file ./de.srt --label "Deutsch"',
      "Set the label shown in the player",
    ],
    ["$0 stream caption delete 1a2b3c4d-... en", "Remove a language again"],
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
        describe: "Language code for the captions (e.g. en, de, pt-br)",
        demandOption: true,
      })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("file", {
        type: "string",
        describe: "Path to the .vtt or .srt caption file",
        demandOption: true,
      })
      .option("label", {
        type: "string",
        describe: "Label shown in the player's caption menu",
      }),

  handler: async ({
    video: ref,
    lang,
    lib,
    file,
    label,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    // Validate everything local before any network call.
    const srclang = captionLanguage(lang);
    const base64 = await readCaptionFile(file);

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

    const result = await withSpinner(`Uploading ${srclang} captions...`, () =>
      addVideoCaption(client, libraryId, video.guid, srclang, {
        label: label?.trim() || undefined,
        base64,
      }),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            id: video.guid,
            title: video.title,
            srclang,
            label: label?.trim() || undefined,
            added: true,
            warnings: result.warnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(`Added ${srclang} captions to ${video.title}.`);
    // The API validates the file and can accept it with non-breaking issues.
    if (result.warningMessage) logger.warn(result.warningMessage);
    for (const warning of result.warnings) logger.dim(`- ${warning}`);
  },
});
