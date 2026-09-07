import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { UserError } from "@/core/errors.ts";
import type { GlobalArgs, OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import type { VideoLibraryModel } from "./api.ts";
import { resolveLibraryInteractive } from "./interactive.ts";
import {
  connectStreamLibrary,
  fetchVideo,
  fetchVideos,
  type StreamClient,
  type VideoModel,
  videoStatusLabel,
} from "./videos-api.ts";

export interface StreamLibraryContext {
  library: VideoLibraryModel;
  libraryId: number;
  client: StreamClient;
}

/**
 * The preamble every video, collection, caption, and paid command shares: resolve the library the same way
 * `stream video upload` does (`--lib`, then the linked directory, then a picker), then
 * open a Stream client authenticated with that library's own API key.
 */
export async function streamLibraryContext(
  args: Pick<GlobalArgs, "profile" | "output" | "verbose" | "apiKey"> & {
    lib?: string;
    offerLink?: boolean;
    /** Destructive commands pass their --force so it disables the picker. */
    force?: boolean;
  },
): Promise<StreamLibraryContext> {
  const config = resolveConfig(args.profile, args.apiKey, args.verbose);
  const coreClient = createCoreClient(clientOptions(config, args.verbose));

  const library = await resolveLibraryInteractive(coreClient, args.lib, {
    output: args.output,
    offerLink: args.offerLink,
    force: args.force,
  });

  return {
    library,
    libraryId: library.Id as number,
    client: connectStreamLibrary(library, { config, verbose: args.verbose }),
  };
}

/**
 * Resolve a video by GUID, or prompt the user to pick one from the library when
 * no reference is given. Manages its own spinner so it never spins over a prompt.
 *
 * Never prompts non-interactively (json output, no TTY, or `force`): errors
 * instead, so a destructive command with --force can't delete a picked video.
 */
export async function resolveVideoInteractive(
  client: StreamClient,
  libraryId: number,
  ref: string | undefined,
  opts: { output?: OutputFormat; force?: boolean } = {},
): Promise<VideoModel> {
  if (ref) {
    return withSpinner("Resolving video...", () =>
      fetchVideo(client, libraryId, ref),
    );
  }

  if (opts.force || !isInteractive(opts.output)) {
    throw new UserError(
      "A video is required.",
      "Pass the video GUID, which `bunny stream video list` prints.",
    );
  }

  const videos = await withSpinner("Fetching videos...", () =>
    fetchVideos(client, libraryId),
  );
  if (videos.length === 0) {
    throw new UserError(
      "No videos found in this library.",
      'Add one with "bunny stream video upload <file>".',
    );
  }

  const { guid } = await prompts({
    type: "select",
    name: "guid",
    message: "Video:",
    choices: videos.map((video) => ({
      title: `${video.title} (${videoStatusLabel(video.status)})`,
      value: video.guid,
    })),
  });
  if (guid === undefined) throw new UserError("A video is required.");

  // The listing returns full video models, so the picked one needs no re-fetch.
  const picked = videos.find((video) => video.guid === guid);
  return picked ?? (await fetchVideo(client, libraryId, guid));
}
