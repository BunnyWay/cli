import { createCoreClient } from "@bunny.net/openapi-client";
import {
  assertFolderSupported,
  BunnyStream,
  createFileStateStore,
  DEFAULT_CONCURRENCY,
  DEFAULT_PROCESSING_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
  MigrationService,
  type MigrationState,
  type MigrationSummary,
  stripAnsi,
} from "@bunny.net/stream-import";
import type { Argv, CommandModule } from "yargs";
import type { VideoLibraryModel } from "@/commands/stream/api.ts";
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
import { formatBytes, formatKeyValue, progressBar } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, withSpinner } from "@/core/ui.ts";
import { VERSION } from "@/core/version.ts";
import {
  importLogger,
  importStatePath,
  resolveImportSource,
  resolveSourceCredentials,
} from "./import-setup.ts";
import { requireSource, SOURCE_IDS } from "./import-sources.ts";

interface ImportArgs {
  lib?: string;
  source?: string;
  folder?: string;
  dryRun?: boolean;
  resume?: boolean;
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
    { key: "To import", value: String(summary.newVideos) },
  ];
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

function renderResult(
  state: MigrationState,
  elapsedMs: number,
  output: OutputFormat,
  resumeCommand: string,
): void {
  const completed = state.videoMigrations.filter(
    (m) => m.status === "completed",
  );
  const failed = state.videoMigrations.filter((m) => m.status === "failed");

  logger.log("");
  logger.log(bunny.bold("Import complete"));
  logger.log(
    formatKeyValue(
      [
        { key: "Completed", value: String(completed.length) },
        { key: "Failed", value: String(failed.length) },
        { key: "Elapsed", value: formatDuration(elapsedMs / 1000) },
      ],
      output,
    ),
  );

  if (failed.length > 0) {
    logger.log("");
    for (const m of failed)
      logger.error(`${stripAnsi(m.videoName)}: ${m.error}`);
    logger.info(`Resume with ${bunny(resumeCommand)}`);
  }
}

export const streamImportCommand: CommandModule = defineCommand<ImportArgs>({
  command: "import",
  describe:
    "Import videos into a Stream library from Vimeo, S3, Wistia, Mux, Cloudflare Stream, JW Player, or Brightcove.",
  examples: [
    [
      "$0 stream import --source vimeo",
      "Interactive: prompts for anything missing",
    ],
    [
      "$0 stream import --lib 12345 --source vimeo --dry-run",
      "Show the plan without importing",
    ],
    [
      "$0 stream import --lib 12345 --source s3 --bucket my-videos --prefix 2024/ --force",
      "Unattended S3 import; credentials from the environment",
    ],
    [
      "$0 stream import --source vimeo --resume",
      "Continue an interrupted import",
    ],
  ],

  builder: (yargs) => {
    return yargs
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
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Skip the confirmation prompt",
      })
      .option("concurrency", {
        alias: "c",
        type: "number",
        default: DEFAULT_CONCURRENCY,
        describe: "Videos to import in parallel (1-20)",
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
          "How long to wait for bunny.net to encode one video, minutes (1-1440)",
      })
      .option("migration-timeout", {
        type: "number",
        describe: "Overall timeout per video, minutes (1-1440)",
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

    const library = await resolveLibraryInteractive(coreClient, args.lib, {
      output,
      offerLink: true,
    });
    const libraryId = library.Id as number;

    const plugin = await resolveImportSource(args.source, output);
    assertFolderSupported(plugin, args.folder);

    const requestTimeout = args.requestTimeout
      ? args.requestTimeout * 1000
      : DEFAULT_REQUEST_TIMEOUT;
    const sourceConfig = await resolveSourceCredentials(
      plugin,
      {
        bucket: args.bucket,
        prefix: args.prefix,
        presignedUrlTtl: args.urlTtl,
      },
      output,
    );
    const engineLog = importLogger(verbose);
    const adapter = plugin.createAdapter(sourceConfig, {
      userAgent: `bunny-cli/${VERSION}`,
      requestTimeout,
      logger: engineLog,
    });
    await withSpinner(`Checking ${plugin.label} credentials...`, () =>
      adapter.validateCredentials(),
    );

    const service = new MigrationService({
      adapter,
      bunny: new BunnyStream({
        client: connectStreamLibrary(library, { config, verbose }),
        libraryId,
        requestTimeout,
        processingTimeout: args.processingTimeout
          ? args.processingTimeout * 60_000
          : DEFAULT_PROCESSING_TIMEOUT,
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

    if (summary.totalVideos === 0 || summary.newVideos === 0) {
      if (output === "json") {
        logger.log(JSON.stringify({ ...base, imported: 0 }, null, 2));

        return;
      }
      if (summary.totalVideos === 0)
        logger.warn(`No videos found at ${plugin.label}.`);
      else logger.success("Everything is already imported.");

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

    const proceed = await confirm(
      `Import ${summary.newVideos} videos into ${library.Name}?`,
      { force: args.force, initial: true },
    );
    if (!proceed) {
      logger.info("Cancelled.");

      return;
    }

    const startedAt = Date.now();
    const state = await service.runMigration({
      folderId: args.folder,
      concurrency: args.concurrency,
      resume: args.resume,
      migrationTimeoutMs: args.migrationTimeout
        ? args.migrationTimeout * 60_000
        : undefined,
      onProgress: (s) => {
        if (output === "json") return;
        const done = s.videoMigrations.filter(
          (m) => m.status === "completed",
        ).length;
        logger.dim(progressBar(done / Math.max(s.videoMigrations.length, 1)));
      },
    });

    const failed = state.videoMigrations.filter((m) => m.status === "failed");
    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            library: base.library,
            source: plugin.id,
            status: state.status,
            completed: state.videoMigrations.filter(
              (m) => m.status === "completed",
            ).length,
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
      renderResult(
        state,
        Date.now() - startedAt,
        output,
        `bunny stream import --lib ${libraryId} --source ${plugin.id} --resume`,
      );
    }
    if (failed.length > 0) process.exitCode = 1;
  },
});
