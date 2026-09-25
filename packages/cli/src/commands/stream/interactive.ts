import type { ToolContext } from "@bunny.net/tools";
import {
  openStreamLibrary,
  type StreamLibrary,
  type StreamLibraryConnection,
  streamLibrariesList,
} from "@bunny.net/tools/stream";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, saveManifest } from "@/core/manifest.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import { STREAM_MANIFEST, type StreamLibraryManifest } from "./constants.ts";

/** Write `.bunny/stream.json` pointing at the library. */
export function writeStreamManifest(library: StreamLibrary): void {
  saveManifest<StreamLibraryManifest>(STREAM_MANIFEST, {
    id: library.id,
    name: library.name || undefined,
  });
}

// Offer to remember a library picked from the prompt; a no-op if the user declines.
async function maybeLinkLibrary(library: StreamLibrary): Promise<void> {
  if (
    !(await confirm(`Link this directory to ${library.name}?`, {
      optional: true,
    }))
  )
    return;
  writeStreamManifest(library);
  logger.success(`Linked this directory to video library ${library.name}.`);
}

/** Open the library named by `ref`, else the linked one, else a picker (TTY only); `offerLink` offers to link a picked library. */
export async function resolveLibraryInteractive(
  ctx: ToolContext,
  ref: string | undefined,
  opts: { output?: OutputFormat; offerLink?: boolean } = {},
): Promise<StreamLibraryConnection> {
  if (ref) {
    return withSpinner("Resolving video library...", () =>
      openStreamLibrary(ctx, ref),
    );
  }

  // A linked library stands in for an explicit ref, even unattended.
  const manifest = loadManifest<StreamLibraryManifest>(STREAM_MANIFEST);
  if (manifest.id) {
    const linkedId = manifest.id;
    return withSpinner("Loading linked video library...", () =>
      openStreamLibrary(ctx, linkedId),
    );
  }

  if (!isInteractive(opts.output)) {
    throw new UserError(
      "A library is required.",
      "Pass --library <name|id>, or link this directory to a library first.",
    );
  }

  const libraries = await withSpinner("Fetching video libraries...", () =>
    streamLibrariesList.run(ctx, {}),
  );
  if (libraries.length === 0) {
    throw new UserError(
      "No video libraries found.",
      "Create a video library in the bunny.net dashboard first.",
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Video library:",
    choices: libraries.map((lib) => ({ title: lib.name, value: lib.id })),
  });
  if (id === undefined) throw new UserError("A library is required.");

  const connection = await withSpinner("Loading video library...", () =>
    openStreamLibrary(ctx, id),
  );
  // The picker only runs interactively, so the link offer can't taint machine output.
  if (opts.offerLink) await maybeLinkLibrary(connection.library);
  return connection;
}
