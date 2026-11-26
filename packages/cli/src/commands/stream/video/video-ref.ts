import { videoStatusLabel } from "@/commands/stream/videos-api.ts";
import { UserError } from "@/core/errors.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import type { ToolContext } from "@/tools/index.ts";
import { streamVideosList } from "@/tools/stream/index.ts";

/**
 * Resolve a video GUID for the tool-backed video commands: the explicit GUID,
 * else a picker over the library's videos.
 *
 * Same rules as `resolveVideoInteractive`, but the listing goes through
 * `src/tools/`, so these commands never open a library connection. An explicit
 * GUID is passed through unchecked; the tool reports a missing video.
 */
export async function resolveVideoRef(
  ctx: ToolContext,
  libraryId: number,
  ref: string | undefined,
  opts: { output?: OutputFormat; force?: boolean } = {},
): Promise<string> {
  if (ref) return ref;

  if (opts.force || !isInteractive(opts.output)) {
    throw new UserError(
      "A video is required.",
      "Pass the video GUID, which `bunny stream videos list` prints.",
    );
  }

  const videos = await withSpinner("Fetching videos...", () =>
    streamVideosList.invoke(ctx, { library: libraryId }),
  );
  if (videos.length === 0) {
    throw new UserError(
      "No videos found in this library.",
      'Add one with "bunny stream videos upload <file>".',
    );
  }

  const { guid } = await prompts({
    type: "select",
    name: "guid",
    message: "Video:",
    choices: videos.map((video) => ({
      title: `${video.title} (${videoStatusLabel(video.status ?? undefined)})`,
      value: video.guid,
    })),
  });
  if (guid === undefined) throw new UserError("A video is required.");
  return guid;
}
