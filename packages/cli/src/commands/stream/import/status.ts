import {
  BunnyStream,
  createFileStateStore,
  DEFAULT_PROCESSING_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
  DEFAULT_STALLED_AFTER_MS,
  readMigrationState,
  refreshMigrationState,
  stripAnsi,
  videoStatusText,
} from "@bunny.net/stream-import";
import type { Argv, CommandModule } from "yargs";
import { formatDuration } from "@/commands/stream/videos-api.ts";
import { bunny } from "@/core/colors.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatBytes, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";
import {
  connectImportTarget,
  findSavedImportSource,
  importLogger,
  importStatePath,
} from "../import-setup.ts";
import { requireSource, SOURCE_IDS } from "../import-sources.ts";

interface StatusArgs {
  lib?: string;
  source?: string;
}

/** `12:05 ago`, from an ISO timestamp; blank when the entry never started. */
function ago(iso: string | null): string {
  if (!iso) return "";
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;

  return seconds < 60 ? "just now" : `${formatDuration(seconds)} ago`;
}

export const streamImportStatusCommand: CommandModule =
  defineCommand<StatusArgs>({
    command: "status",
    describe: "Show how far Bunny has got with a queued import.",
    examples: [
      [
        "$0 stream import status --lib 12345 --source vimeo",
        "Progress of the Vimeo import into library 12345",
      ],
      ["$0 stream import status --output json", "The same, as JSON"],
    ],

    builder: (yargs) =>
      yargs
        .option("lib", {
          alias: "library",
          type: "string",
          describe:
            "Destination video library ID (defaults to the linked library)",
        })
        .option("source", {
          alias: "s",
          type: "string",
          choices: SOURCE_IDS,
          describe:
            "Source platform (defaults to the only one with a saved import)",
        }) as Argv<StatusArgs>,

    handler: async (args) => {
      const { output, verbose } = args;
      const { library, libraryId, accountId, stream } =
        await connectImportTarget(args);

      const plugin = requireSource(
        args.source ?? findSavedImportSource(libraryId, accountId),
      );
      const statePath = importStatePath(plugin.id, libraryId, accountId);
      const saved = readMigrationState(statePath);
      if (!saved) {
        throw new UserError(
          `No ${plugin.label} import found for library ${library.Name}.`,
          `Start one with \`bunny stream import --lib ${libraryId} --source ${plugin.id}\`.`,
        );
      }

      const engine = new BunnyStream({
        client: stream,
        libraryId,
        requestTimeout: DEFAULT_REQUEST_TIMEOUT,
        processingTimeout: DEFAULT_PROCESSING_TIMEOUT,
        logger: importLogger(verbose),
      });
      const { state, videos, stalled } = await withSpinner(
        "Checking with Bunny...",
        () => refreshMigrationState(saved, engine),
      );
      createFileStateStore(statePath).save(state);

      const rows = state.videoMigrations.map((m) => {
        const video = m.bunnyVideoId ? videos.get(m.bunnyVideoId) : undefined;
        const isStalled = Boolean(
          m.bunnyVideoId && stalled.has(m.bunnyVideoId),
        );
        const label = video
          ? `${videoStatusText(video.status)}${isStalled ? " (stalled?)" : ""}`
          : m.status === "failed"
            ? "Failed"
            : m.status === "pending"
              ? "Not queued"
              : "Queued";

        return {
          name: m.videoName,
          sourceId: m.sourceVideoId,
          bunnyVideoId: m.bunnyVideoId,
          status: m.status,
          bunnyStatus: label,
          stalled: isStalled,
          encodeProgress: m.encodeProgress,
          size: video?.storageSize ?? 0,
          queuedAt: m.startedAt,
          error: m.error,
        };
      });
      const failed = rows.filter((r) => r.status === "failed");
      const completed = rows.filter((r) => r.status === "completed").length;
      const processing = rows.filter((r) => r.status === "processing").length;

      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              library: { id: library.Id, name: library.Name },
              source: plugin.id,
              status: state.status,
              completed,
              processing,
              failed: failed.length,
              videos: rows,
            },
            null,
            2,
          ),
        );
      } else {
        logger.log(bunny.bold(`${plugin.label} to ${library.Name}`));
        logger.log(
          formatTable(
            ["Video", "Bunny status", "Encoded", "Size", "Queued"],
            rows.map((r) => [
              stripAnsi(r.name),
              r.bunnyStatus,
              `${r.encodeProgress}%`,
              r.size ? formatBytes(r.size) : "",
              ago(r.queuedAt),
            ]),
            output,
          ),
        );
        logger.log("");
        logger.info(
          `${completed} finished, ${processing} processing, ${failed.length} failed.`,
        );
        if (stalled.size > 0) {
          logger.warn(
            `${stalled.size} videos have been processing with no data for over ${DEFAULT_STALLED_AFTER_MS / 60_000} minutes. If that persists, Bunny's fetch may have failed silently: delete them in the dashboard and re-run the import.`,
          );
        }
        if (failed.length > 0) {
          for (const r of failed)
            logger.error(`${stripAnsi(r.name)}: ${r.error}`);
          logger.info(
            `Retry with ${bunny(`bunny stream import --lib ${libraryId} --source ${plugin.id} --resume`)}`,
          );
        }
      }
      if (failed.length > 0) process.exitCode = 1;
    },
  });
