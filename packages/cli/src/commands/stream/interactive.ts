import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, saveManifest } from "@/core/manifest.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, prompts, spinner } from "@/core/ui.ts";
import {
  type CoreClient,
  fetchLibraries,
  fetchLibrary,
  resolveLibrary,
  type VideoLibraryModel,
} from "./api.ts";
import { STREAM_MANIFEST, type StreamLibraryManifest } from "./constants.ts";

/** Write `.bunny/stream.json` pointing at the library. */
export function writeStreamManifest(library: VideoLibraryModel): void {
  saveManifest<StreamLibraryManifest>(STREAM_MANIFEST, {
    id: library.Id ?? 0,
    name: library.Name ?? undefined,
  });
}

// Offer to remember a library picked from the prompt; a no-op if the user declines.
async function maybeLinkLibrary(library: VideoLibraryModel): Promise<void> {
  if (
    !(await confirm(`Link this directory to ${library.Name}?`, {
      optional: true,
    }))
  )
    return;
  writeStreamManifest(library);
  logger.success(`Linked this directory to video library ${library.Name}.`);
}

/**
 * Resolve a video library by name/ID, or prompt the user to pick one when no
 * reference is given. Manages its own spinner so it never spins over a prompt.
 *
 * When `offerLink` is set and the library is chosen via the picker (not an
 * explicit ref or the existing manifest), offer to link the directory to it.
 * Pass `ignoreManifest` to always pick (used when (re)linking a directory).
 * Never prompts non-interactively (json output, no TTY, or `force`): errors instead.
 */
export async function resolveLibraryInteractive(
  client: CoreClient,
  ref: string | undefined,
  opts: {
    output?: OutputFormat;
    force?: boolean;
    offerLink?: boolean;
    ignoreManifest?: boolean;
  } = {},
): Promise<VideoLibraryModel> {
  if (ref) {
    const spin = spinner("Resolving video library...");
    spin.start();
    try {
      return await resolveLibrary(client, ref);
    } finally {
      spin.stop();
    }
  }

  // A library linked via `bunny stream library link` stands in for an explicit ref, even unattended.
  if (!opts.ignoreManifest) {
    const manifest = loadManifest<StreamLibraryManifest>(STREAM_MANIFEST);
    if (manifest.id) {
      const spin = spinner("Loading linked video library...");
      spin.start();
      try {
        return await fetchLibrary(client, manifest.id);
      } finally {
        spin.stop();
      }
    }
  }

  // No library given: only fall back to the picker when we can actually prompt (--force opts out too).
  if (opts.force || !isInteractive(opts.output)) {
    throw new UserError(
      "A library is required.",
      "Pass a library name or ID, use --lib where applicable, or link one with `bunny stream library link`.",
    );
  }

  const spin = spinner("Fetching video libraries...");
  spin.start();
  let libraries: VideoLibraryModel[];
  try {
    libraries = await fetchLibraries(client);
  } finally {
    spin.stop();
  }

  if (libraries.length === 0) {
    throw new UserError(
      "No video libraries found.",
      'Create one with "bunny stream library create <name>".',
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Video library:",
    choices: libraries.map((lib) => ({ title: lib.Name ?? "", value: lib.Id })),
  });
  if (id === undefined) throw new UserError("A library is required.");

  const loadSpin = spinner("Loading video library...");
  loadSpin.start();
  let library: VideoLibraryModel;
  try {
    library = await fetchLibrary(client, id);
  } finally {
    loadSpin.stop();
  }

  // The picker only runs interactively, so the link offer can't taint machine output.
  if (opts.offerLink) {
    await maybeLinkLibrary(library);
  }
  return library;
}
