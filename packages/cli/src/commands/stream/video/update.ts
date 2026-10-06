import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import {
  fetchVideo,
  type UpdateVideoModel,
  updateVideo,
  type VideoModel,
} from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";

interface VideoUpdateArgs {
  video?: string;
  lib?: string;
  title?: string;
  collection?: string;
  chapters?: string;
  moments?: string;
}

/**
 * The title to save, or undefined when the prompt was cancelled or left blank.
 *
 * `--title` wins; otherwise an interactive run with no other field flags is
 * offered the current title to edit.
 */
export async function nextVideoTitle(
  current: string,
  title: string | undefined,
  interactive: boolean,
): Promise<string | undefined> {
  const explicit = title?.trim();
  if (explicit) return explicit;

  if (!interactive) {
    throw new UserError(
      "Nothing to update.",
      "Pass --title to set a new title.",
    );
  }

  const { value } = await prompts({
    type: "text",
    name: "value",
    message: "Title:",
    initial: current,
  });
  // A blank answer is treated as "leave it alone", like a cancel.
  return (value as string | undefined)?.trim() || undefined;
}

/**
 * Parse a JSON array flag (`--chapters`, `--moments`).
 *
 * Only inline JSON is accepted; the value must be an array of objects, since a
 * malformed body would otherwise clear the field server side.
 */
export function parseJsonArrayFlag(
  flag: string,
  value: string,
): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    throw new UserError(
      `--${flag} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      `Pass a JSON array, e.g. --${flag} '[{"title":"Intro","start":0,"end":30}]'`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new UserError(
      `--${flag} must be a JSON array.`,
      `Got ${parsed === null ? "null" : typeof parsed}.`,
    );
  }
  if (
    parsed.some(
      (entry) =>
        entry === null || typeof entry !== "object" || Array.isArray(entry),
    )
  ) {
    throw new UserError(`--${flag} must be an array of objects.`);
  }
  return parsed as Record<string, unknown>[];
}

/**
 * The sparse update body: only the fields whose flags were given.
 *
 * Returns an empty object when no field flag was passed, which is what makes the
 * interactive title prompt the fallback.
 */
export function videoUpdateBody(args: VideoUpdateArgs): UpdateVideoModel {
  const body: UpdateVideoModel = {};
  const title = args.title?.trim();
  if (title) body.title = title;
  // An empty --collection clears the assignment, so only `undefined` means "leave it".
  if (args.collection !== undefined)
    body.collectionId = args.collection.trim() || "";
  if (args.chapters !== undefined) {
    body.chapters = parseJsonArrayFlag(
      "chapters",
      args.chapters,
    ) as UpdateVideoModel["chapters"];
  }
  if (args.moments !== undefined) {
    body.moments = parseJsonArrayFlag(
      "moments",
      args.moments,
    ) as UpdateVideoModel["moments"];
  }
  return body;
}

/** Whether the body would change anything the video does not already say. */
function isNoOp(body: UpdateVideoModel, video: VideoModel): boolean {
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "title" && body.title === video.title;
}

export const streamVideoUpdateCommand = defineCommand<VideoUpdateArgs>({
  command: "update [video]",
  describe: "Update a video's title, collection, chapters, or moments.",
  examples: [
    [
      '$0 stream video update 1a2b3c4d-... --title "Launch demo"',
      "Rename a video",
    ],
    ["$0 stream video update", "Pick a video, then edit its title"],
    [
      "$0 stream video update 1a2b3c4d-... --collection 8a7b6c5d-...",
      "Move it into a collection",
    ],
    [
      `$0 stream video update 1a2b3c4d-... --chapters '[{"title":"Intro","start":0,"end":30}]'`,
      "Replace the chapter list",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", {
        type: "string",
        describe: "Video GUID",
      })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("title", {
        type: "string",
        describe: "New video title (prompts if no other field flag is given)",
      })
      .option("collection", {
        type: "string",
        describe:
          "Collection ID to move the video to, from `bunny stream collection list` (empty string clears it)",
      })
      .option("chapters", {
        type: "string",
        describe:
          'Chapters as a JSON array, e.g. \'[{"title":"Intro","start":0,"end":30}]\'',
      })
      .option("moments", {
        type: "string",
        describe:
          'Moments as a JSON array, e.g. \'[{"label":"Demo","timestamp":42}]\'',
      }),

  handler: async (args) => {
    const { video: ref, lib, profile, output, verbose, apiKey } = args;
    // Parse the field flags before any network call so bad JSON costs nothing.
    const body = videoUpdateBody(args);

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

    // With no field flags at all, fall back to editing the title interactively.
    if (Object.keys(body).length === 0) {
      const wanted = await nextVideoTitle(
        video.title,
        args.title,
        isInteractive(output),
      );
      if (wanted === undefined) {
        logger.log("Cancelled.");
        return;
      }
      body.title = wanted;
    }

    if (isNoOp(body, video)) {
      if (output === "json") {
        logger.log(JSON.stringify(video, null, 2));
        return;
      }
      logger.log("Title unchanged.");
      return;
    }

    await withSpinner("Updating video...", () =>
      updateVideo(client, libraryId, video.guid, body),
    );
    const updated = await withSpinner("Reading video...", () =>
      fetchVideo(client, libraryId, video.guid),
    );

    if (output === "json") {
      logger.log(JSON.stringify(updated, null, 2));
      return;
    }

    logger.success(`Updated ${updated.title}.`);
  },
});
