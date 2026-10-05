import {
  resolveVideoInteractive,
  streamLibraryContext,
} from "@/commands/stream/context.ts";
import {
  type CleanupResolutionsQuery,
  cleanupVideoResolutions,
  fetchVideoResolutions,
} from "@/commands/stream/videos-api.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";
import {
  type CleanupPlan,
  cleanupItemLabel,
  cleanupPlan,
  informativeMessage,
} from "./cleanup-plan.ts";

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
function cleanupSummary(query: CleanupResolutionsQuery): string[] {
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

/** `HLS 240p, 360p; MP4 720p; Original file`, for the confirmation prompt. */
function planSummary(plan: CleanupPlan): string {
  const groups = new Map<string, string[]>();
  for (const item of plan.items) {
    const key =
      item.kind === "original" ? "Original file" : item.kind.toUpperCase();
    const list = groups.get(key) ?? [];
    if (item.resolution) list.push(item.resolution);
    groups.set(key, list);
  }
  return [...groups]
    .map(([key, list]) => (list.length ? `${key} ${list.join(", ")}` : key))
    .join("; ");
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

    // The endpoint's dry run only returns a status message, so the list of what
    // would go comes from the video's resolutions info.
    const info = await withSpinner("Reading the video's resolutions...", () =>
      fetchVideoResolutions(client, libraryId, video.guid),
    );
    const plan = cleanupPlan(info, query);

    if (!args.dryRun && plan.items.length === 0) {
      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              id: video.guid,
              title: video.title,
              dryRun: false,
              ...query,
              plan,
              deleted: false,
            },
            null,
            2,
          ),
        );
        return;
      }
      logger.log(
        `Nothing to delete from ${video.title} for ${summary.join(", ")}.`,
      );
      if (plan.notPresent.length)
        logger.dim(`Not on this video: ${plan.notPresent.join(", ")}.`);
      return;
    }

    if (!args.dryRun) {
      requireConfirmable(output, {
        force,
        message: `Cleaning up "${video.title}" needs a confirmation prompt.`,
        hint: "Re-run with --force, or add --dry-run to preview instead.",
      });
      const confirmed = await confirm(
        `Delete ${planSummary(plan)} from ${video.title}? This cannot be undone.`,
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
            plan,
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
        ],
        output,
      ),
    );

    const verb = args.dryRun ? "Would delete" : "Deleted";
    if (plan.items.length === 0) {
      logger.log("Nothing matches the selection, so nothing would be deleted.");
    } else {
      logger.log(`${verb} (${plan.items.length}):`);
      for (const item of plan.items) {
        logger.log(
          `  ${cleanupItemLabel(item)}${item.path ? `  ${item.path}` : ""}`,
        );
      }
    }
    if (plan.notPresent.length) {
      logger.dim(`Not on this video: ${plan.notPresent.join(", ")}.`);
    }
    const message = informativeMessage(status.message);
    if (message) logger.dim(`API: ${message}`);

    if (args.dryRun) {
      logger.dim("Nothing was deleted. Re-run without --dry-run to apply.");
    } else {
      logger.success(`Cleaned up ${video.title}.`);
    }
  },
});
