import type { ToolContext } from "@bunny.net/tools";
import {
  type LibrarySummary,
  streamLibrariesList,
  streamLibrariesResolve,
} from "@bunny.net/tools/stream";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, saveManifest } from "@/core/manifest.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, prompts, spinner } from "@/core/ui.ts";
import { STREAM_MANIFEST, type StreamLibraryManifest } from "../constants.ts";

async function spin<T>(text: string, run: () => Promise<T>): Promise<T> {
  const s = spinner(text);
  s.start();
  try {
    return await run();
  } finally {
    s.stop();
  }
}

/**
 * Resolve a library for the tool-backed `library` subcommands (`player`,
 * `security`): explicit name or ID, then the linked directory, then a picker.
 *
 * Same order and rules as the other stream commands, but every lookup goes
 * through `@bunny.net/tools`, so these commands never create an API client.
 * Kept out of `interactive.ts` so it doesn't collide with stream import work.
 */
export async function resolveLibraryRef(
  ctx: ToolContext,
  ref: string | undefined,
  opts: { output?: OutputFormat; force?: boolean; offerLink?: boolean } = {},
): Promise<LibrarySummary> {
  if (ref) {
    return spin("Resolving video library...", () =>
      streamLibrariesResolve.invoke(ctx, { library: ref }),
    );
  }

  // A library linked via `bunny stream library link` stands in for an explicit ref, even unattended.
  const manifest = loadManifest<StreamLibraryManifest>(STREAM_MANIFEST);
  if (manifest.id) {
    return spin("Loading linked video library...", () =>
      streamLibrariesResolve.invoke(ctx, { library: String(manifest.id) }),
    );
  }

  if (opts.force || !isInteractive(opts.output)) {
    throw new UserError(
      "A library is required.",
      "Pass a library name or ID, or link one with `bunny stream library link`.",
    );
  }

  const libraries = await spin("Fetching video libraries...", () =>
    streamLibrariesList.invoke(ctx, {}),
  );
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
    choices: libraries.map((lib) => ({ title: lib.name, value: lib.id })),
  });
  const picked = libraries.find((lib) => lib.id === id);
  if (!picked) throw new UserError("A library is required.");

  if (
    opts.offerLink &&
    (await confirm(`Link this directory to ${picked.name}?`, {
      optional: true,
    }))
  ) {
    saveManifest<StreamLibraryManifest>(STREAM_MANIFEST, {
      id: picked.id,
      name: picked.name,
    });
    logger.success(`Linked this directory to video library ${picked.name}.`);
  }
  return picked;
}
