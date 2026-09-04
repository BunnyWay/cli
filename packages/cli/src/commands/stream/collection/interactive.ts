import {
  type CollectionModel,
  fetchCollection,
  fetchCollections,
} from "@/commands/stream/collection-api.ts";
import type { StreamClient } from "@/commands/stream/videos-api.ts";
import { UserError } from "@/core/errors.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";

/**
 * Resolve a collection by ID, or prompt the user to pick one from the library
 * when no reference is given. Mirrors the video resolver.
 *
 * Never prompts non-interactively (json output, no TTY, or `force`): errors
 * instead, so a destructive command with --force can't delete a picked collection.
 */
export async function resolveCollectionInteractive(
  client: StreamClient,
  libraryId: number,
  ref: string | undefined,
  opts: { output?: OutputFormat; force?: boolean } = {},
): Promise<CollectionModel> {
  if (ref) {
    return withSpinner("Resolving collection...", () =>
      fetchCollection(client, libraryId, ref),
    );
  }

  if (opts.force || !isInteractive(opts.output)) {
    throw new UserError(
      "A collection is required.",
      "Pass the collection ID, which `bunny stream collection list` prints.",
    );
  }

  const collections = await withSpinner("Fetching collections...", () =>
    fetchCollections(client, libraryId),
  );
  if (collections.length === 0) {
    throw new UserError(
      "No collections found in this library.",
      'Create one with "bunny stream collection create --name <name>".',
    );
  }

  const { guid } = await prompts({
    type: "select",
    name: "guid",
    message: "Collection:",
    choices: collections.map((collection) => ({
      title: `${collection.name} (${collection.videoCount ?? 0} video(s))`,
      value: collection.guid,
    })),
  });
  if (guid === undefined) throw new UserError("A collection is required.");

  // The listing returns full collection models, so the picked one needs no re-fetch.
  const picked = collections.find((collection) => collection.guid === guid);
  return picked ?? (await fetchCollection(client, libraryId, guid));
}
