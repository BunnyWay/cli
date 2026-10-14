import type { VideoLibraryModel } from "@/commands/stream/api.ts";
import {
  STREAM_MANIFEST,
  type StreamLibraryManifest,
} from "@/commands/stream/constants.ts";
import {
  IMPORT_FLAG_DEFAULTS,
  streamImportRunCommand,
} from "@/commands/stream/import/run.ts";
import { writeStreamManifest } from "@/commands/stream/interactive.ts";
import { streamVideoUploadCommand } from "@/commands/stream/video/upload.ts";
import { examplesUrl } from "@/core/examples.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest } from "@/core/manifest.ts";
import type { GlobalArgs, OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, prompts } from "@/core/ui.ts";
import { readEnvValue, writeEnvValue } from "@/utils/env-file.ts";

// The names the Stream examples read, so a saved .env works with them as is.
export const ENV_STREAM_LIBRARY_ID = "BUNNY_STREAM_LIBRARY_ID";
export const ENV_STREAM_API_KEY = "BUNNY_STREAM_API_KEY";

/** Link this directory to the new library: the flag decides, else ask when interactive. */
export async function offerLink(
  library: VideoLibraryModel,
  flag: boolean | undefined,
  output: OutputFormat | undefined,
): Promise<boolean> {
  let link = flag;
  if (link === undefined && isInteractive(output)) {
    const existing = loadManifest<StreamLibraryManifest>(STREAM_MANIFEST);
    link = await confirm(
      existing.id && existing.id !== library.Id
        ? `Link this directory to ${library.Name}? (replaces the existing link to ${existing.name ?? existing.id})`
        : `Link this directory to ${library.Name}?`,
      { optional: true },
    );
  }
  if (!link) return false;
  writeStreamManifest(library);
  if (output !== "json")
    logger.success(`Linked this directory to video library ${library.Name}.`);
  return true;
}

/** Save the library ID and API key to the nearest .env that already holds them, else ./.env. */
export async function offerSaveEnv(
  library: VideoLibraryModel,
  flag: boolean | undefined,
  output: OutputFormat | undefined,
): Promise<boolean> {
  const apiKey = library.ApiKey;
  if (!library.Id || !apiKey) return false;

  const existing =
    readEnvValue(ENV_STREAM_LIBRARY_ID) ?? readEnvValue(ENV_STREAM_API_KEY);
  let save = flag;
  if (save === undefined && isInteractive(output)) {
    save = await confirm(
      existing
        ? `Save ${ENV_STREAM_LIBRARY_ID} and ${ENV_STREAM_API_KEY} to .env? (replaces the values in ${existing.envPath})`
        : `Save ${ENV_STREAM_LIBRARY_ID} and ${ENV_STREAM_API_KEY} to .env?`,
      { optional: true },
    );
  }
  if (!save) return false;
  const envPath = writeEnvValue(
    ENV_STREAM_LIBRARY_ID,
    String(library.Id),
    existing?.envPath,
  );
  writeEnvValue(ENV_STREAM_API_KEY, apiKey, envPath);
  if (output !== "json")
    logger.success(
      `Saved ${ENV_STREAM_LIBRARY_ID} and ${ENV_STREAM_API_KEY} to ${envPath}`,
    );
  return true;
}

/**
 * Ask how the user wants to add videos, and hand off to `stream import` or
 * `stream video upload` with the new library filled in. Interactive only.
 */
export async function offerAddVideos(
  library: VideoLibraryModel,
  globals: Pick<GlobalArgs, "profile" | "output" | "verbose" | "apiKey">,
): Promise<void> {
  const { how } = await prompts({
    type: "select",
    name: "how",
    message: "How do you want to add videos?",
    choices: [
      {
        title: "Import from another platform",
        description:
          "Vimeo, S3, Mux, Wistia, Cloudflare, JW Player, Brightcove",
        value: "import" as const,
      },
      { title: "Upload a file now", value: "upload" as const },
      {
        title: "Later",
        description: "From your app, the API, or the dashboard",
        value: "later" as const,
      },
    ],
  });

  const lib = String(library.Id);
  if (how === "import") {
    logger.log();
    await streamImportRunCommand.handler({
      ...globals,
      ...IMPORT_FLAG_DEFAULTS,
      library: lib,
      _: [],
      $0: "bunny",
    });
  } else if (how === "upload") {
    const { file } = await prompts({
      type: "text",
      name: "file",
      message: "Path to the video file:",
    });
    const path = typeof file === "string" ? file.trim() : "";
    if (!path) return;
    await streamVideoUploadCommand.handler({
      ...globals,
      file: path,
      lib,
      _: [],
      $0: "bunny",
    });
  }
}

/** The commands and links to carry on with, printed last. */
export function printNextSteps(library: VideoLibraryModel): void {
  const id = library.Id;
  logger.log();
  logger.dim(
    `  Upload a video:  bunny stream videos upload <file> --lib ${id}`,
  );
  logger.dim(
    `  Import videos:   bunny stream import --library ${id} --source <platform>`,
  );
  logger.dim(`  Credentials:     bunny stream libraries credentials ${id}`);
  logger.dim(`  Examples:        ${examplesUrl("stream")}`);
}
