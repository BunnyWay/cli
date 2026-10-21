import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { addVideoCaption } from "@/commands/stream/caption-api.ts";
import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { localFileArg } from "@/core/file-arg.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";

interface CaptionAddArgs {
  video?: string;
  lang?: string;
  lib?: string;
  label?: string;
  file?: string;
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

/** The label shown in the player's caption menu; the API rejects a caption without one, so it falls back to the language code. */
export function captionLabel(
  label: string | undefined,
  srclang: string,
): string {
  return label?.trim() || srclang;
}

/** A missing language code with no way to ask for it. */
export function languageRequired(usage: string): UserError {
  return new UserError(
    "A language code is required.",
    `Pass it after the video: ${usage}`,
  );
}

const ADD_USAGE = "bunny stream videos captions add <file> <video> <lang>";

/** The caption language: the argument, else asked for when interactive. */
export async function captionLanguageArg(
  lang: string | undefined,
  output: OutputFormat | undefined,
): Promise<string> {
  if (lang) return captionLanguage(lang);
  if (!isInteractive(output)) throw languageRequired(ADD_USAGE);
  const { value } = await prompts({
    type: "text",
    name: "value",
    message: "Language code for the captions (e.g. en, de, pt-br):",
  });
  if (typeof value !== "string" || !value.trim()) {
    throw new UserError("A language code is required.");
  }
  return captionLanguage(value);
}

export const streamCaptionAddCommand = defineCommand<CaptionAddArgs>({
  command: "add [file] [video] [lang]",
  aliases: ["upload"],
  describe: "Upload a caption file for one language.",
  examples: [
    [
      "$0 stream videos captions add ./captions.vtt 1a2b3c4d-... en",
      "Add English captions",
    ],
    [
      "$0 stream videos captions add",
      "Pick the caption file and the video, then type the language",
    ],
    [
      '$0 stream videos captions add ./de.srt 1a2b3c4d-... de --label "Deutsch"',
      "Set the label shown in the player",
    ],
    [
      "$0 stream videos captions remove 1a2b3c4d-... en",
      "Remove a language again",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        describe: "Path to the .vtt or .srt caption file (prompts if omitted)",
      })
      .positional("video", {
        type: "string",
        describe:
          "Video GUID (see `bunny stream videos list`; prompts if omitted)",
      })
      .positional("lang", {
        type: "string",
        describe:
          "Language code for the captions (e.g. en, de, pt-br; prompts if omitted)",
      })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("label", {
        type: "string",
        describe:
          "Label shown in the player's caption menu (defaults to the language code)",
      }),

  handler: async ({
    video: ref,
    lang,
    lib,
    file: fileArg,
    label,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    // Validate everything local before any network call; a missing language is asked for after the video.
    const given = lang ? captionLanguage(lang) : undefined;
    const file = await localFileArg(fileArg, {
      output,
      noun: "caption file",
      extensions: CAPTION_EXTENSIONS,
      usage: ADD_USAGE,
    });
    const base64 = await readCaptionFile(file);
    if (!given && !isInteractive(output)) throw languageRequired(ADD_USAGE);

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
    const srclang = given ?? (await captionLanguageArg(lang, output));
    const shownLabel = captionLabel(label, srclang);

    const result = await withSpinner(`Uploading ${srclang} captions...`, () =>
      addVideoCaption(client, libraryId, video.guid, srclang, {
        label: shownLabel,
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
            label: shownLabel,
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
