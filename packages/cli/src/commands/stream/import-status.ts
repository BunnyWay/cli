import { existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { createCoreClient } from "@bunny.net/openapi-client";
import {
  BunnyStream,
  createFileStateStore,
  DEFAULT_PROCESSING_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
  readMigrationState,
  refreshMigrationState,
  stripAnsi,
  videoStatusText,
} from "@bunny.net/stream-import";
import type { Argv, CommandModule } from "yargs";
import { resolveLibraryInteractive } from "@/commands/stream/interactive.ts";
import {
  connectStreamLibrary,
  formatDuration,
} from "@/commands/stream/videos-api.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { bunny } from "@/core/colors.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatBytes, formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { withSpinner } from "@/core/ui.ts";
import { importStatusCommand } from "./import.ts";
import { importLogger, importStatePath } from "./import-setup.ts";
import { requireSource, SOURCE_IDS } from "./import-sources.ts";

/** Bunny reports nothing for a fetch that died silently, so a video at 0% this long after queueing is flagged. */
const STALLED_AFTER_MINUTES = 30;

interface StatusArgs {
  lib?: string;
  source?: string;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const seconds = (Date.now() - Date.parse(iso)) / 1000;

  return seconds < 60 ? "just now" : `${formatDuration(seconds)} ago`;
}

/** The one source with a saved import for this library, when `--source` was left out. */
function savedImportSource(libraryId: number): string {
  const dir = dirname(importStatePath("x", libraryId));
  const suffix = `-${libraryId}.json`;
  const sources = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(suffix))
        .map((f) => f.slice(0, -suffix.length))
        .filter((id) => SOURCE_IDS.includes(id))
    : [];

  if (sources.length === 1 && sources[0]) return sources[0];
  throw new UserError(
    sources.length === 0
      ? `No saved import for library ${libraryId}.`
      : `Library ${libraryId} has imports from ${sources.join(", ")}.`,
    sources.length === 0
      ? "Start one with `bunny stream import`."
      : "Pass --source to pick one.",
  );
}

export const streamImportStatusCommand: CommandModule =
  defineCommand<StatusArgs>({
    command: "status",
    describe: "Show how far Bunny has got with an import.",
    examples: [
      [
        "$0 stream import status --library 12345 --source vimeo",
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
      const config = resolveConfig(args.profile, args.apiKey, verbose);
      const coreClient = createCoreClient(clientOptions(config, verbose));
      const library = await resolveLibraryInteractive(coreClient, args.lib, {
        output,
      });
      const libraryId = library.Id as number;

      const plugin = requireSource(args.source ?? savedImportSource(libraryId));
      const statePath = importStatePath(plugin.id, libraryId);
      const state = readMigrationState(statePath);
      if (!state) {
        throw new UserError(
          `No ${plugin.label} import found for library ${library.Name}.`,
          `Start one with \`bunny stream import --library ${libraryId} --source ${plugin.id}\`.`,
        );
      }

      const engine = new BunnyStream({
        client: connectStreamLibrary(library, { config, verbose }),
        libraryId,
        requestTimeout: DEFAULT_REQUEST_TIMEOUT,
        processingTimeout: DEFAULT_PROCESSING_TIMEOUT,
        logger: importLogger(verbose),
      });
      const videos = await withSpinner("Checking with Bunny...", () =>
        refreshMigrationState(state, engine),
      );
      createFileStateStore(statePath, {
        onWarn: (message) => logger.warn(message),
      }).save(state);

      const rows = state.videoMigrations.map((m) => {
        const video = m.bunnyVideoId ? videos.get(m.bunnyVideoId) : undefined;
        const stalled =
          m.status === "processing" &&
          m.encodeProgress === 0 &&
          m.startedAt !== null &&
          Date.now() - Date.parse(m.startedAt) > STALLED_AFTER_MINUTES * 60_000;
        const label = video
          ? videoStatusText(video.status)
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
          bunnyStatus: stalled ? `${label} (stalled?)` : label,
          stalled,
          encodeProgress: m.encodeProgress,
          size: video?.storageSize ?? 0,
          queuedAt: m.startedAt,
          error: m.error,
        };
      });
      const failed = rows.filter((r) => r.status === "failed");
      const completed = rows.filter((r) => r.status === "completed").length;
      const processing = rows.filter((r) => r.status === "processing").length;
      const stalled = rows.filter((r) => r.stalled).length;
      const resume = `bunny stream import --library ${libraryId} --source ${plugin.id} --resume`;

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
              stalled,
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
        if (stalled > 0)
          logger.warn(
            `${stalled} videos have made no progress in ${STALLED_AFTER_MINUTES} minutes. Delete them in the dashboard, then run ${bunny(resume)}`,
          );
        if (failed.length > 0) {
          for (const r of failed)
            logger.error(`${stripAnsi(r.name)}: ${r.error}`);
          logger.info(`Retry with ${bunny(resume)}`);
        } else if (processing > 0) {
          logger.dim(
            `Run ${importStatusCommand(libraryId, plugin.id)} again to refresh.`,
          );
        }
      }
      if (failed.length > 0) process.exitCode = 1;
    },
  });
