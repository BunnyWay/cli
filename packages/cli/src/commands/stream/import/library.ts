import {
  STREAM_MANIFEST,
  type StreamLibraryManifest,
} from "@/commands/stream/constants.ts";
import { writeStreamManifest } from "@/commands/stream/interactive.ts";
import {
  describeFeatures,
  featureBillingWarnings,
  promptLibraryFeatures,
} from "@/commands/stream/library/features.ts";
import { resolveReplicationRegions } from "@/commands/stream/library/replication-regions.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest } from "@/core/manifest.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import type { ToolContext } from "@/tools/index.ts";
import {
  assertLanguages,
  type LibraryFeatures,
  type StreamLibrary,
  streamLanguagesList,
  streamLibrariesCreate,
  streamLibrariesList,
  streamLibrariesResolve,
} from "@/tools/stream/index.ts";

/** The library features step as answered by flags (see `libraryFeaturesFromFlags`). */
export interface FeatureFlags {
  features: LibraryFeatures | undefined;
  /** The flags that answered it, for error messages. */
  flags: string[];
}

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
  featureFlags: FeatureFlags | undefined,
): Promise<boolean> {
  if (!offerCreate) return false;
  // Flags that choose features describe a new library, so they answer this too.
  if (existing === 0 || featureFlags) return true;

  const { mode } = await prompts({
    type: "select",
    name: "mode",
    message: "Import into:",
    choices: [
      { title: "A new video library", value: "new" },
      { title: "An existing video library", value: "existing" },
    ],
    initial: 0,
  });

  if (!mode) throw new UserError("A video library is required.");

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
  if (!library) throw new UserError("A video library is required.");

  return library;
}

async function createImportLibrary(
  ctx: ToolContext,
  output: OutputFormat | undefined,
  featureFlags: FeatureFlags | undefined,
): Promise<StreamLibrary> {
  // The prompt only offers supported languages; flags are checked against
  // the live list before anything is asked, created or billed.
  const languages = featureFlags?.features?.transcribing?.languages;
  if (languages?.length) {
    const supported = await withSpinner("Checking languages...", () =>
      streamLanguagesList.invoke(ctx, {}),
    );
    assertLanguages(languages, supported, "transcribing");
  }

  const { value } = await prompts({
    type: "text",
    name: "value",
    message: "Name for the new video library:",
  });

  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new UserError("A library name is required.");

  // The same two steps as `stream libraries create`: regions, then features,
  // which the feature flags answer instead of asking.
  const regions = await resolveReplicationRegions(undefined, output);
  const features = featureFlags
    ? featureFlags.features
    : await promptLibraryFeatures(ctx, output);
  const library = await withSpinner("Creating video library...", () =>
    streamLibrariesCreate.invoke(ctx, { name, regions, features }),
  );

  logger.success(`Created video library ${library.name} (ID: ${library.id}).`);
  for (const line of describeFeatures(features)) logger.dim(`Enabled: ${line}`);
  for (const warning of featureBillingWarnings(features)) logger.warn(warning);

  return library;
}

export async function resolveImportLibrary(
  ctx: ToolContext,
  ref: string | undefined,
  opts: {
    output?: OutputFormat;
    offerLink?: boolean;
    offerCreate?: boolean;
    /** Flags that answer the features step of a new library. */
    featureFlags?: FeatureFlags;
  } = {},
): Promise<StreamLibrary> {
  // --no-features alone only skips a step, so it is harmless on an existing
  // library; flags that choose features would be silently dropped there.
  const features = opts.featureFlags?.features ? opts.featureFlags : undefined;
  const newOnly = features
    ? `${features.flags.join(", ")} set up a new library, which this import doesn't create`
    : "";
  if (features && ref) {
    throw new UserError(
      `${newOnly}: --library names an existing one.`,
      "Drop --library to create a new library, or change the existing one with `bunny stream libraries update`.",
    );
  }

  if (ref) {
    return withSpinner("Resolving video library...", () =>
      streamLibrariesResolve.invoke(ctx, { library: ref }),
    );
  }

  // A linked library stands in for an explicit ref, even unattended.
  const manifest = loadManifest<StreamLibraryManifest>(STREAM_MANIFEST);
  if (manifest.id) {
    if (features) {
      throw new UserError(
        `${newOnly}: this directory is linked to video library ${manifest.id}.`,
        "Run `bunny stream libraries unlink` to import into a new library, or change the linked one with `bunny stream libraries update`.",
      );
    }
    const linkedId = manifest.id;
    return withSpinner("Loading linked video library...", () =>
      streamLibrariesResolve.invoke(ctx, { library: String(linkedId) }),
    );
  }

  if (!isInteractive(opts.output)) {
    throw new UserError(
      "A video library is required.",
      features
        ? "A new library for the import is named in a terminal. Unattended, create it first with `bunny stream libraries create <name>`, which takes the same encoding and transcribing flags, then pass --library <name|id>."
        : "Pass --library <name|id>, or link one with `bunny stream libraries link`.",
    );
  }
  if (features && !opts.offerCreate) {
    throw new UserError(
      `${newOnly}: --dry-run and --resume use an existing library.`,
      "Drop the feature flags, or run without --dry-run or --resume to create the library.",
    );
  }

  const libraries = await withSpinner("Fetching video libraries...", () =>
    streamLibrariesList.invoke(ctx, {}),
  );
  const library = (await chooseNewLibrary(
    libraries.length,
    opts.offerCreate,
    features,
  ))
    ? await createImportLibrary(ctx, opts.output, opts.featureFlags)
    : await pickLibrary(libraries);
  // The picker only runs interactively, so the link offer can't taint machine output.
  if (opts.offerLink) await maybeLinkLibrary(library);
  return library;
}
