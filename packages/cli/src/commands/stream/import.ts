import { createCoreClient } from "@bunny.net/openapi-client";
import {
  assertFolderSupported,
  BunnyStream,
  createFileStateStore,
  DEFAULT_CONCURRENCY,
  DEFAULT_PROCESSING_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
  type MigrationPhase,
  MigrationService,
  type MigrationState,
  type MigrationSummary,
  type SourceConfigValues,
  type SourcePlugin,
  stripAnsi,
} from "@bunny.net/stream-import";
import type { Argv, CommandModule } from "yargs";
import type { VideoLibraryModel } from "@/commands/stream/api.ts";
import { resolveLibraryInteractive } from "@/commands/stream/interactive.ts";
import {
  connectStreamLibrary,
  formatDuration,
} from "@/commands/stream/videos-api.ts";
import {
  deleteImportCredentials,
  getImportCredentials,
  resolveConfig,
  setImportCredentials,
} from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { bunny } from "@/core/colors.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatBytes, formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, spinner, withSpinner } from "@/core/ui.ts";
import { VERSION } from "@/core/version.ts";
import {
  importLogger,
  importStatePath,
  resolveImportSource,
  resolveSourceCredentials,
} from "./import-setup.ts";
import { requireSource, SOURCE_IDS } from "./import-sources.ts";

interface ImportArgs {
  library?: string;
  lib?: string;
  source?: string;
  folder?: string;
  dryRun?: boolean;
  resume?: boolean;
  wait?: boolean;
  force?: boolean;
  concurrency: number;
  bucket?: string;
  prefix?: string;
  urlTtl?: number;
  requestTimeout?: number;
  processingTimeout?: number;
  migrationTimeout?: number;
}

function assertRange(
  value: number | undefined,
  min: number,
  max: number,
  flag: string,
): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UserError(
      `${flag} must be an integer between ${min} and ${max}.`,
    );
  }
}

function libraryJson(library: VideoLibraryModel) {
  return { id: library.Id, name: library.Name };
}

export function importStatusCommand(libraryId: number, source: string): string {
  return `bunny stream import status --library ${libraryId} --source ${source}`;
}

function renderSummary(
  library: VideoLibraryModel,
  sourceLabel: string,
  summary: MigrationSummary,
  output: OutputFormat,
): void {
  const entries = [
    { key: "Library", value: `${library.Name} (${library.Id})` },
    {
      key: "Source",
      value: `${sourceLabel}: ${summary.totalVideos} videos in ${summary.totalFolders} folders`,
    },
    { key: "Already imported", value: String(summary.alreadyMigrated) },
  ];
  if (summary.processingOnBunny > 0)
    entries.push({
      key: "Processing on Bunny",
      value: String(summary.processingOnBunny),
    });
  if (summary.failedOnBunny > 0)
    entries.push({
      key: "Failed on Bunny",
      value: `${summary.failedOnBunny} (will be imported again)`,
    });
  entries.push({ key: "To import", value: String(summary.newVideos) });
  if (summary.totalDuration > 0)
    entries.push({
      key: "Duration",
      value: formatDuration(summary.totalDuration),
    });
  if (summary.totalSize > 0)
    entries.push({ key: "Size", value: formatBytes(summary.totalSize) });

  logger.log(bunny.bold(`${sourceLabel} to Bunny Stream`));
  logger.log(formatKeyValue(entries, output));
  logger.log("");
}

/** The dry-run plan: every video that would be imported, grouped by the collection it would land in. */
function renderPlan(summary: MigrationSummary): void {
  const byFolder = new Map<string | null, string[]>();
  for (const video of summary.newVideosList) {
    const list = byFolder.get(video.folder) ?? [];
    list.push(video.name);
    byFolder.set(video.folder, list);
  }

  logger.log(bunny.bold("Import plan"));
  for (const [folder, names] of byFolder) {
    logger.log(
      `${stripAnsi(folder ?? "(no collection)")} (${names.length} videos)`,
    );
    for (const name of names) logger.log(`  - ${stripAnsi(name)}`);
  }
  if (summary.alreadyMigrated > 0) {
    logger.log("");
    logger.log(`${summary.alreadyMigrated} already imported, skipped.`);
  }
}

function counts(state: MigrationState) {
  const by = (status: string) =>
    state.videoMigrations.filter((m) => m.status === status);

  return {
    completed: by("completed").length,
    processing: by("processing").length,
    failed: by("failed"),
  };
}

/** The one progress line: videos handed over during the handoff, then encode progress while waiting. */
function progressText(state: MigrationState, phase: MigrationPhase): string {
  const all = state.videoMigrations;
  if (phase === "handoff") {
    const done = all.filter(
      (m) => m.status !== "pending" && m.status !== "fetching",
    ).length;

    return `Handing videos to Bunny: ${done}/${all.length}`;
  }
  const tracked = all.filter((m) => m.bunnyVideoId);
  const { completed, failed } = counts(state);
  const average = tracked.length
    ? Math.round(
        tracked.reduce((sum, m) => sum + m.encodeProgress, 0) / tracked.length,
      )
    : 0;
  const tail = failed.length > 0 ? `, ${failed.length} failed` : "";

  return `Encoding: ${completed}/${tracked.length} finished, ${average}% average${tail}`;
}

function renderResult(
  state: MigrationState,
  library: VideoLibraryModel,
  elapsedMs: number,
  output: OutputFormat,
  opts: {
    waited: boolean;
    libraryId: number;
    source: string;
    resumeCommand: string;
  },
): void {
  const { completed, processing, failed } = counts(state);
  const status = importStatusCommand(opts.libraryId, opts.source);

  if (opts.waited) {
    logger.log(bunny.bold("Import complete"));
    logger.log(
      formatKeyValue(
        [
          { key: "Completed", value: String(completed) },
          ...(processing > 0
            ? [{ key: "Still processing", value: String(processing) }]
            : []),
          { key: "Failed", value: String(failed.length) },
          { key: "Elapsed", value: formatDuration(elapsedMs / 1000) },
        ],
        output,
      ),
    );
    if (processing > 0)
      logger.info(
        `Stopped waiting on ${processing} videos still processing. Check them with ${bunny(status)}`,
      );
  } else if (processing > 0) {
    logger.success(
      `Queued ${processing} videos into ${library.Name}. Bunny is fetching and encoding them now.`,
    );
    logger.info(`Check progress with ${bunny(status)}`);
  } else if (failed.length === 0) {
    logger.success(`Imported ${completed} videos into ${library.Name}.`);
  }

  if (failed.length > 0) {
    logger.log("");
    for (const m of failed)
      logger.error(`${stripAnsi(m.videoName)}: ${m.error}`);
    logger.info(`Resume with ${bunny(opts.resumeCommand)}`);
  }
}

/** After a successful credential check, offer to keep what was typed so the next run (or `--resume`) skips the prompt. */
async function offerToSaveCredentials(
  plugin: SourcePlugin,
  entered: SourceConfigValues,
  profile: string,
): Promise<void> {
  if (Object.keys(entered).length === 0) return;
  const save = await confirm(
    `Save ${plugin.label} credentials for next time?`,
    {
      initial: true,
      optional: true,
    },
  );
  if (!save) {
    logger.dim(
      `Set ${plugin.credentials.map((f) => f.env).join(", ")} to skip these prompts next time.`,
    );

    return;
  }
  setImportCredentials(profile, plugin.id, {
    ...getImportCredentials(profile, plugin.id),
    ...entered,
  });
  logger.success(
    `Saved ${plugin.label} credentials to the "${profile}" profile.`,
  );
}

/**
 * `bunny stream import` and `bunny stream library import` share one command.
 * The library mount takes the library as a positional, matching its siblings;
 * the stream mount takes `--lib`, matching every other stream command.
 */
export function defineStreamImportCommand(opts: {
  libraryPositional: boolean;
}): CommandModule {
  const mount = opts.libraryPositional
    ? "stream library import"
    : "stream import";
  const libraryExample = opts.libraryPositional ? "my-library" : "--lib 12345";

  return defineCommand<ImportArgs>({
    // Under `bunny stream import` this is the namespace's default command, next to `status`.
    command: opts.libraryPositional ? "import [library]" : "$0",
    describe: opts.libraryPositional
      ? "Import videos into a Stream library from Vimeo, S3, Wistia, Mux, Cloudflare Stream, JW Player, or Brightcove."
      : (false as never),
    examples: [
      [
        `$0 ${mount} --source vimeo`,
        "Interactive: prompts for anything missing",
      ],
      [
        `$0 ${mount} ${libraryExample} --source vimeo --dry-run`,
        "Show the plan without importing",
      ],
      [
        `$0 ${mount} ${libraryExample} --source s3 --bucket my-videos --prefix 2024/ --force`,
        "Unattended S3 import; credentials from the environment",
      ],
      [
        `$0 ${mount} ${libraryExample} --source vimeo --wait`,
        "Stay until Bunny has encoded every video",
      ],
      [`$0 ${mount} --source vimeo --resume`, "Continue an interrupted import"],
    ],

    builder: (yargs) => {
      let y: Argv = yargs;
      if (opts.libraryPositional) {
        y = y.positional("library", {
          type: "string",
          describe: "Destination video library name or ID",
        });
      } else {
        y = y.option("lib", {
          alias: "library",
          type: "string",
          describe:
            "Destination video library ID (defaults to the linked library)",
        });
      }

      return y
        .option("source", {
          alias: "s",
          type: "string",
          choices: SOURCE_IDS,
          describe: "Source platform",
        })
        .option("folder", {
          type: "string",
          describe: "Import one source folder only (sources with folders)",
        })
        .option("dry-run", {
          type: "boolean",
          describe: "Show what would be imported without changing anything",
        })
        .option("resume", {
          type: "boolean",
          describe: "Continue the saved import for this source and library",
        })
        .option("wait", {
          type: "boolean",
          describe:
            "Stay until Bunny has encoded every video (default: return once they are queued)",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          describe: "Skip the confirmation prompt",
        })
        .option("concurrency", {
          alias: "c",
          type: "number",
          default: DEFAULT_CONCURRENCY,
          describe: "Videos to hand to Bunny in parallel (1-20)",
        })
        .option("bucket", { type: "string", describe: "S3 bucket override" })
        .option("prefix", { type: "string", describe: "S3 prefix override" })
        .option("url-ttl", {
          type: "number",
          describe: "S3 pre-signed URL lifetime in seconds (60-604800)",
        })
        .option("request-timeout", {
          type: "number",
          describe: "HTTP timeout per request, seconds (1-3600)",
        })
        .option("processing-timeout", {
          type: "number",
          describe:
            "With --wait: how long to wait for Bunny to encode one video, minutes (1-1440)",
        })
        .option("migration-timeout", {
          type: "number",
          describe:
            "Timeout per video for the handoff to Bunny, minutes (1-1440)",
        }) as Argv<ImportArgs>;
    },

    preRun: async (args) => {
      assertRange(args.concurrency, 1, 20, "--concurrency");
      assertRange(args.requestTimeout, 1, 3600, "--request-timeout");
      assertRange(args.processingTimeout, 1, 1440, "--processing-timeout");
      assertRange(args.migrationTimeout, 1, 1440, "--migration-timeout");
      assertRange(args.urlTtl, 60, 604800, "--url-ttl");
      // An argument error should not wait on a library lookup or a credential check.
      if (args.source)
        assertFolderSupported(requireSource(args.source), args.folder);
    },

    handler: async (args) => {
      const { output, verbose } = args;
      const config = resolveConfig(args.profile, args.apiKey, verbose);
      const coreClient = createCoreClient(clientOptions(config, verbose));

      const library = await resolveLibraryInteractive(
        coreClient,
        opts.libraryPositional ? args.library : args.lib,
        { output, offerLink: true },
      );
      const libraryId = library.Id as number;

      const plugin = await resolveImportSource(
        args.source,
        args.profile,
        output,
      );
      assertFolderSupported(plugin, args.folder);

      const requestTimeout = args.requestTimeout
        ? args.requestTimeout * 1000
        : DEFAULT_REQUEST_TIMEOUT;
      const credentials = await resolveSourceCredentials(
        plugin,
        {
          bucket: args.bucket,
          prefix: args.prefix,
          presignedUrlTtl: args.urlTtl,
        },
        args.profile,
        output,
      );
      const engineLog = importLogger(verbose);
      const adapter = plugin.createAdapter(credentials.config, {
        userAgent: `bunny-cli/${VERSION}`,
        requestTimeout,
        logger: engineLog,
      });
      try {
        await withSpinner(`Checking ${plugin.label} credentials...`, () =>
          adapter.validateCredentials(),
        );
      } catch (error) {
        if (credentials.fromSaved && error instanceof UserError) {
          deleteImportCredentials(args.profile, plugin.id);
          logger.warn(
            `Removed the saved ${plugin.label} credentials. Run again to enter new ones.`,
          );
        }
        throw error;
      }
      await offerToSaveCredentials(plugin, credentials.entered, args.profile);

      const service = new MigrationService({
        adapter,
        bunny: new BunnyStream({
          client: connectStreamLibrary(library, { config, verbose }),
          libraryId,
          requestTimeout,
          processingTimeout: DEFAULT_PROCESSING_TIMEOUT,
          logger: engineLog,
        }),
        store: createFileStateStore(importStatePath(plugin.id, libraryId), {
          onWarn: (message) => logger.warn(message),
        }),
        logger: engineLog,
        libraryId: String(libraryId),
        label: plugin.label,
      });

      const summary = await withSpinner(
        `Discovering ${plugin.label} content...`,
        () => service.getSummary(args.folder),
      );
      const base = {
        library: libraryJson(library),
        source: plugin.id,
        summary,
      };

      if (output !== "json")
        renderSummary(library, plugin.label, summary, output);

      if (summary.totalVideos === 0) {
        if (output === "json")
          logger.log(JSON.stringify({ ...base, imported: 0 }, null, 2));
        else logger.warn(`No videos found at ${plugin.label}.`);

        return;
      }

      // Nothing to hand over: it is all done, or Bunny is still working and only --wait has a reason to stay.
      if (
        summary.newVideos === 0 &&
        !(args.wait && summary.processingOnBunny > 0)
      ) {
        if (output === "json") {
          logger.log(
            JSON.stringify(
              { ...base, imported: 0, processing: summary.processingOnBunny },
              null,
              2,
            ),
          );

          return;
        }
        if (summary.processingOnBunny > 0) {
          logger.info(
            `Nothing new to import; ${summary.processingOnBunny} videos are still processing on Bunny.`,
          );
          logger.info(
            `Check progress with ${bunny(importStatusCommand(libraryId, plugin.id))}, or re-run with --wait.`,
          );
        } else logger.success("Everything is already imported.");

        return;
      }

      if (args.dryRun) {
        if (output === "json") {
          logger.log(JSON.stringify({ ...base, dryRun: true }, null, 2));

          return;
        }
        renderPlan(summary);
        logger.log("");
        logger.info("Dry run. Remove --dry-run to import for real.");

        return;
      }

      if (summary.newVideos > 0) {
        const proceed = await confirm(
          `Import ${summary.newVideos} videos into ${library.Name}?`,
          { force: args.force, initial: true },
        );
        if (!proceed) {
          logger.info("Cancelled.");

          return;
        }
      }

      const startedAt = Date.now();
      // Engine lines go to --verbose; without it, one spinner line carries the progress.
      const spin =
        output === "json" || verbose
          ? undefined
          : spinner("Handing videos to Bunny...").start();
      let state: MigrationState;
      try {
        state = await service.runMigration({
          folderId: args.folder,
          concurrency: args.concurrency,
          resume: args.resume,
          wait: args.wait,
          processingTimeoutMs: args.processingTimeout
            ? args.processingTimeout * 60_000
            : undefined,
          migrationTimeoutMs: args.migrationTimeout
            ? args.migrationTimeout * 60_000
            : undefined,
          onProgress: (s, phase) => {
            if (spin) spin.text = progressText(s, phase);
          },
        });
      } finally {
        spin?.stop();
      }

      const { completed, processing, failed } = counts(state);
      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              library: base.library,
              source: plugin.id,
              status: state.status,
              waited: Boolean(args.wait),
              completed,
              processing,
              failed: failed.map((m) => ({
                video: m.videoName,
                error: m.error,
              })),
              collections: state.folderMappings,
              elapsedMs: Date.now() - startedAt,
            },
            null,
            2,
          ),
        );
      } else {
        renderResult(state, library, Date.now() - startedAt, output, {
          waited: Boolean(args.wait),
          libraryId,
          source: plugin.id,
          resumeCommand: `bunny ${mount} ${opts.libraryPositional ? libraryId : `--library ${libraryId}`} --source ${plugin.id}${args.folder ? ` --folder ${args.folder}` : ""} --resume`,
        });
      }
      if (failed.length > 0) process.exitCode = 1;
    },
  });
}

export const streamImportCommand = defineStreamImportCommand({
  libraryPositional: false,
});
export const streamLibraryImportCommand = defineStreamImportCommand({
  libraryPositional: true,
});
