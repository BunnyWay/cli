import {
  STREAM_MANIFEST,
  type StreamLibraryManifest,
} from "@/commands/stream/constants.ts";
import { writeStreamManifest } from "@/commands/stream/interactive.ts";
import { resolveReplicationRegions } from "@/commands/stream/library/create.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest } from "@/core/manifest.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import type { ToolContext } from "@/tools/index.ts";
import {
  type StreamLibrary,
  streamLibrariesCreate,
  streamLibrariesList,
  streamLibrariesResolve,
} from "@/tools/stream/index.ts";

// Offer to remember a library picked from the prompt; a no-op if the user declines.
async function maybeLinkLibrary(library: StreamLibrary): Promise<void> {
  if (
    !(await confirm(`Link this directory to ${library.name}?`, {
      optional: true,
    }))
  )
    return;
  writeStreamManifest({ Id: library.id, Name: library.name });
  logger.success(`Linked this directory to video library ${library.name}.`);
}

async function chooseNewLibrary(
  existing: number,
  offerCreate: boolean | undefined,
): Promise<boolean> {
  if (!offerCreate) return false;
  if (existing === 0) return true;

  const { mode } = await prompts({
    type: "select",
    name: "mode",
    message: "Import into:",
    choices: [
      { title: "A new library", value: "new" },
      { title: "An existing library", value: "existing" },
    ],
    initial: 0,
  });

  if (!mode) throw new UserError("A library is required.");

  return mode === "new";
}

async function pickLibrary(libraries: StreamLibrary[]): Promise<StreamLibrary> {
  if (libraries.length === 0) {
    throw new UserError(
      "No video libraries found.",
      'Create one with "bunny stream libraries create <name>".',
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Video library:",
    choices: libraries.map((lib) => ({ title: lib.name, value: lib.id })),
  });

  const library = libraries.find((lib) => lib.id === id);
  if (!library) throw new UserError("A library is required.");

  return library;
}

async function createImportLibrary(
  ctx: ToolContext,
  output: OutputFormat | undefined,
): Promise<StreamLibrary> {
  const { value } = await prompts({
    type: "text",
    name: "value",
    message: "Name for the new video library:",
  });

  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new UserError("A library name is required.");

  const regions = await resolveReplicationRegions(undefined, output);
  const library = await withSpinner("Creating video library...", () =>
    streamLibrariesCreate.invoke(ctx, { name, regions }),
  );

  logger.success(`Created video library ${library.name} (ID: ${library.id}).`);

  return library;
}

export async function resolveImportLibrary(
  ctx: ToolContext,
  ref: string | undefined,
  opts: {
    output?: OutputFormat;
    offerLink?: boolean;
    offerCreate?: boolean;
  } = {},
): Promise<StreamLibrary> {
  if (ref) {
    return withSpinner("Resolving video library...", () =>
      streamLibrariesResolve.invoke(ctx, { library: ref }),
    );
  }

  // A linked library stands in for an explicit ref, even unattended.
  const manifest = loadManifest<StreamLibraryManifest>(STREAM_MANIFEST);
  if (manifest.id) {
    const linkedId = manifest.id;
    return withSpinner("Loading linked video library...", () =>
      streamLibrariesResolve.invoke(ctx, { library: String(linkedId) }),
    );
  }

  if (!isInteractive(opts.output)) {
    throw new UserError(
      "A library is required.",
      "Pass --library <name|id>, or link one with `bunny stream libraries link`.",
    );
  }

  const libraries = await withSpinner("Fetching video libraries...", () =>
    streamLibrariesList.invoke(ctx, {}),
  );
  const library = (await chooseNewLibrary(libraries.length, opts.offerCreate))
    ? await createImportLibrary(ctx, opts.output)
    : await pickLibrary(libraries);
  // The picker only runs interactively, so the link offer can't taint machine output.
  if (opts.offerLink) await maybeLinkLibrary(library);
  return library;
}
