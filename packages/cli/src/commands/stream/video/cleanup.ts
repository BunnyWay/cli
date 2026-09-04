import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import {
  type CleanupResolutionsQuery,
  cleanupVideoResolutions,
} from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";

interface CleanupArgs {
  video?: string;
  lib?: string;
  resolutions?: string;
  nonConfigured?: boolean;
  all?: boolean;
  original?: boolean;
  outputs?: string;
  mp4?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

const OUTPUT_CHOICES = ["hls", "mp4", "all"] as const;

const FLAG_HINT =
  "Pass at least one of --resolutions, --non-configured, --all, --original, --mp4.";

/**
 * Build the cleanup query, sending only what was asked for.
 *
 * Every field is a query param on the endpoint; the booleans default to false
 * server side, so unset flags are simply left out.
 */
export function cleanupQuery(args: CleanupArgs): CleanupResolutionsQuery {
  const query: CleanupResolutionsQuery = {};

  const resolutions = args.resolutions
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (resolutions?.length) query.resolutionsToDelete = resolutions.join(",");

  if (args.nonConfigured) query.deleteNonConfiguredResolutions = true;
  if (args.all) query.allResolutions = true;
  if (args.original) query.deleteOriginal = true;
  if (args.mp4) query.deleteMp4Files = true;
  if (args.dryRun) query.dryRun = true;

  if (args.outputs) {
    const outputs = args.outputs.trim().toLowerCase();
    if (!OUTPUT_CHOICES.includes(outputs as (typeof OUTPUT_CHOICES)[number])) {
      throw new UserError(
        `Invalid --outputs "${args.outputs}".`,
        `Supported values: ${OUTPUT_CHOICES.join(", ")}.`,
      );
    }
    query.outputs = outputs;
  }

  // Every selector is off by default, so an empty query would delete nothing and
  // read as a silent success.
  const selects =
    query.resolutionsToDelete !== undefined ||
    query.deleteNonConfiguredResolutions === true ||
    query.allResolutions === true ||
    query.deleteOriginal === true ||
    query.deleteMp4Files === true;
  if (!selects) throw new UserError("Nothing selected to clean up.", FLAG_HINT);

  return query;
}

/** Human-readable summary of what the cleanup will touch. */
export function cleanupSummary(query: CleanupResolutionsQuery): string[] {
  const parts: string[] = [];
  if (query.allResolutions) parts.push("every resolution");
  if (query.resolutionsToDelete)
    parts.push(`resolutions ${query.resolutionsToDelete}`);
  if (query.deleteNonConfiguredResolutions)
    parts.push("resolutions not configured on the library");
  if (query.deleteMp4Files) parts.push("MP4 files");
  if (query.deleteOriginal) parts.push("the original file");
  if (query.outputs) parts.push(`outputs: ${query.outputs}`);
  return parts;
}

export const streamVideoCleanupCommand = defineCommand<CleanupArgs>({
  command: "cleanup [video]",
  describe: "Delete encoded resolutions or the original file of a video.",
  examples: [
    [
      "$0 stream video cleanup 1a2b3c4d-... --non-configured --dry-run",
      "Report what would be removed",
    ],
    [
      "$0 stream video cleanup 1a2b3c4d-... --resolutions 240p,360p",
      "Delete specific resolutions",
    ],
    [
      "$0 stream video cleanup 1a2b3c4d-... --original --force",
      "Delete the stored original without confirming",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("video", { type: "string", describe: "Video GUID" })
      .option("lib", {
        alias: "library",
        type: "string",
        describe: "Video library ID (defaults to the linked library)",
      })
      .option("resolutions", {
        type: "string",
        describe: "Resolutions to delete, comma-separated (e.g. 240p,360p)",
      })
      .option("non-configured", {
        type: "boolean",
        describe: "Delete resolutions that are not configured on the library",
      })
      .option("all", {
        type: "boolean",
        describe: "Delete every encoded resolution",
      })
      .option("original", {
        type: "boolean",
        describe: "Delete the stored original file",
      })
      .option("outputs", {
        type: "string",
        describe: `Outputs to clean: ${OUTPUT_CHOICES.join(" | ")}`,
      })
      .option("mp4", {
        type: "boolean",
        describe: "Delete the MP4 fallback files",
      })
      .option("dry-run", {
        type: "boolean",
        describe: "Report what would be deleted without deleting anything",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation prompt",
      }),

  handler: async (args) => {
    const { video: ref, lib, force, profile, output, verbose, apiKey } = args;
    const query = cleanupQuery(args);

    const { client, libraryId } = await streamLibraryContext({
      lib,
      profile,
      output,
      verbose,
      apiKey,
      // Destructive unless --dry-run, so it neither offers linking nor picks under --force.
      force: args.dryRun ? undefined : force,
    });

    const video = await resolveVideoInteractive(client, libraryId, ref, {
      output,
      force: args.dryRun ? undefined : force,
    });

    const summary = cleanupSummary(query);
    if (!args.dryRun) {
      requireConfirmable(output, {
        force,
        message: `Cleaning up "${video.title}" needs a confirmation prompt.`,
        hint: "Re-run with --force, or add --dry-run to preview instead.",
      });
      const confirmed = await confirm(
        `Delete ${summary.join(", ")} from ${video.title}? This cannot be undone.`,
        { force },
      );
      if (!confirmed) {
        logger.log("Cancelled.");
        return;
      }
    }

    const status = await withSpinner(
      args.dryRun ? "Checking cleanup..." : "Cleaning up resolutions...",
      () => cleanupVideoResolutions(client, libraryId, video.guid, query),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            id: video.guid,
            title: video.title,
            dryRun: Boolean(args.dryRun),
            ...query,
            ...status,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.log(
      formatKeyValue(
        [
          { key: "Video", value: `${video.title} (${video.guid})` },
          { key: "Selection", value: summary.join(", ") },
          { key: "Dry run", value: args.dryRun ? "yes" : "no" },
          { key: "Result", value: status.message ?? "ok" },
        ],
        output,
      ),
    );
    if (args.dryRun) {
      logger.dim("Nothing was deleted. Re-run without --dry-run to apply.");
    } else {
      logger.success(`Cleaned up ${video.title}.`);
    }
  },
});
