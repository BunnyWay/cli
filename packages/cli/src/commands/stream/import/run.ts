import {
  assertFolderSupported,
  DEFAULT_CONCURRENCY,
  DEFAULT_MIGRATION_TIMEOUT,
  DEFAULT_PROCESSING_TIMEOUT,
  DEFAULT_REQUEST_TIMEOUT,
  type SourcePlugin,
  stripAnsi,
} from "@bunny.net/stream-import";
import { extendToolContext } from "@bunny.net/tools";
import {
  type ImportPlan,
  type ImportRun,
  requireSource,
  SOURCE_IDS,
  SOURCES,
  streamImportPlan,
  streamImportRun,
} from "@bunny.net/tools/stream";
import type { Argv } from "yargs";
import { bunny } from "@/core/colors.ts";
import { DONE, defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatBytes, formatDuration, formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, requireConfirmable } from "@/core/ui.ts";
import {
  promptSourceCredentials,
  resolveImportSource,
  withToolSpinner,
} from "../import-setup.ts";
import { resolveLibraryInteractive } from "../interactive.ts";

interface ImportArgs {
  library?: string;
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
  videoTimeout?: number;
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

// Greedy word wrap with a hanging indent, so yargs (which wraps at 80 columns with no indent) leaves the lines alone.
function wrap(words: string[], indent: number, width = 78): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && indent + line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : `${" ".repeat(indent)}${l}`));
}

/** The `--help` epilogue: each source's credential variables, generated from the registry so it cannot drift. */
export function credentialsHelp(): string {
  const width = Math.max(...SOURCE_IDS.map((id) => id.length)) + 2;
  const names = (fields: SourcePlugin["credentials"]) =>
    fields.map((f) => [f.env, ...(f.fallbackEnv ?? [])].join(" or "));
  const lines = SOURCES.flatMap((plugin) => {
    const required = names(plugin.credentials.filter((f) => f.required));
    const optional = names(plugin.credentials.filter((f) => !f.required));
    const words = [
      ...required.map((n, i) => (i < required.length - 1 ? `${n},` : n)),
      ...(optional.length
        ? [
            "(optional:",
            ...optional.map((n, i) =>
              i < optional.length - 1 ? `${n},` : `${n})`,
            ),
          ]
        : []),
    ];
    return `  ${plugin.id.padEnd(width)}${wrap(words, width + 2).join("\n")}`;
  });
  return [
    "Source credentials are read from these environment variables:",
    ...lines,
  ].join("\n");
}

function statusCommand(libraryId: number, source: string): string {
  return `bunny stream import status --library ${libraryId} --source ${source}`;
}

function renderSummary(
  plan: ImportPlan,
  sourceLabel: string,
  output: OutputFormat,
): void {
  const { library, summary } = plan;
  const entries = [
    { key: "Library", value: `${library.name} (${library.id})` },
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
function renderPlan(summary: ImportPlan["summary"]): void {
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

function renderResult(result: ImportRun, output: OutputFormat): void {
  const { library, failed } = result;

  for (const warning of result.warnings) logger.warn(warning);
  logger.log("");
  if (result.waited) {
    logger.log(bunny.bold("Import complete"));
    logger.log(
      formatKeyValue(
        [
          { key: "Completed", value: String(result.completed) },
          { key: "Failed", value: String(failed.length) },
          { key: "Elapsed", value: formatDuration(result.elapsedMs / 1000) },
        ],
        output,
      ),
    );
  } else if (result.processing > 0) {
    logger.success(
      `Queued ${result.processing} videos into ${library.name}. Bunny is fetching and encoding them now.`,
    );
    logger.info(
      `Check progress with ${bunny(statusCommand(library.id, result.source))}`,
    );
  }

  if (failed.length > 0) {
    logger.log("");
    for (const m of failed) logger.error(`${stripAnsi(m.name)}: ${m.error}`);
    const folder = result.folder ? ` --folder ${result.folder}` : "";
    logger.info(
      `Resume with ${bunny(`bunny stream import --library ${library.id} --source ${result.source}${folder} --resume`)}`,
    );
  }
}

export const streamImportRunCommand = defineToolCommand({
  tool: streamImportRun,
  command: "$0",
  describe: "Import videos into a Stream library.",
  // Hidden from the namespace's command list: it *is* `bunny stream import`.
  hidden: true,
  progress: "Importing...",
  examples: [
    [
      "$0 stream import --source vimeo",
      "Interactive: prompts for anything missing",
    ],
    [
      "$0 stream import --library 12345 --source vimeo --dry-run",
      "Show the plan without importing",
    ],
    [
      "$0 stream import --library 12345 --source s3 --bucket my-videos --prefix 2024/ --force",
      "Unattended S3 import; credentials from the environment",
    ],
    [
      "$0 stream import --library 12345 --source vimeo --wait",
      "Stay until Bunny has encoded every video",
    ],
    [
      "$0 stream import --source vimeo --resume",
      "Continue an interrupted import",
    ],
  ],
  epilogue: credentialsHelp(),

  builder: (yargs) => {
    return yargs
      .option("library", {
        alias: "lib",
        type: "string",
        describe:
          "Destination video library name or ID (defaults to the linked library)",
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
        default: DEFAULT_REQUEST_TIMEOUT / 1000,
        describe: "Seconds before one HTTP request gives up (1-3600)",
      })
      .option("video-timeout", {
        type: "number",
        default: DEFAULT_MIGRATION_TIMEOUT / 1000,
        describe:
          "Seconds before one video's hand-off to Bunny, or its encode wait with --wait, gives up (60-86400)",
      })
      .option("processing-timeout", {
        type: "number",
        default: DEFAULT_PROCESSING_TIMEOUT / 1000,
        describe:
          "With --wait: seconds to wait for Bunny to encode one video; raises --video-timeout when larger (60-86400)",
      }) as Argv<ImportArgs>;
  },

  preRun: async (args) => {
    assertRange(args.concurrency, 1, 20, "--concurrency");
    assertRange(args.requestTimeout, 1, 3600, "--request-timeout");
    assertRange(args.videoTimeout, 60, 86400, "--video-timeout");
    assertRange(args.processingTimeout, 60, 86400, "--processing-timeout");
    assertRange(args.urlTtl, 60, 604800, "--url-ttl");
    // An argument error should not wait on a library lookup or a credential check.
    if (args.source)
      assertFolderSupported(requireSource(args.source), args.folder);
  },

  prepare: async (args, ctx) => {
    const { output } = args;
    const library = await resolveLibraryInteractive(ctx, args.library, {
      output,
      offerLink: !args.dryRun,
    });
    const plugin = await resolveImportSource(ctx, args.source, output);
    const env = await promptSourceCredentials(
      plugin,
      {
        bucket: args.bucket,
        prefix: args.prefix,
        presignedUrlTtl: args.urlTtl,
      },
      output,
    );
    const target = {
      library: String(library.id),
      source: plugin.id,
      folder: args.folder,
      resume: args.resume,
      bucket: args.bucket,
      prefix: args.prefix,
      urlTtl: args.urlTtl,
      requestTimeout: args.requestTimeout,
    };
    const plan = await withToolSpinner(
      extendToolContext(ctx, { env }),
      "Resolving video library...",
      (stepCtx) => streamImportPlan.invoke(stepCtx, target),
    );
    const { summary } = plan;
    if (plan.folderFromSavedRun)
      logger.info(`Resuming the import of folder ${plan.folder}.`);

    const dryRun = Boolean(args.dryRun);
    // Every exit before the run prints this one shape, so `dryRun` is always present.
    const printPlan = () =>
      logger.log(
        JSON.stringify(
          {
            library: plan.library,
            source: plan.source,
            dryRun,
            imported: 0,
            processing: summary.processingOnBunny,
            summary,
          },
          null,
          2,
        ),
      );

    if (output !== "json") renderSummary(plan, plugin.label, output);

    if (summary.totalVideos === 0) {
      if (output === "json") printPlan();
      else logger.warn(`No videos found at ${plugin.label}.`);

      return DONE;
    }

    // Nothing to hand over: either it is all done, or Bunny is still working and only --wait has a reason to stay.
    if (
      summary.newVideos === 0 &&
      !(args.wait && summary.processingOnBunny > 0)
    ) {
      if (output === "json") {
        printPlan();

        return DONE;
      }
      if (summary.processingOnBunny > 0) {
        logger.info(
          `Nothing new to import; ${summary.processingOnBunny} videos are still processing on Bunny.`,
        );
        logger.info(
          `Check progress with ${bunny(statusCommand(library.id, plugin.id))}, or re-run with --wait.`,
        );
      } else logger.success("Everything is already imported.");

      return DONE;
    }

    if (dryRun) {
      if (output === "json") {
        printPlan();

        return DONE;
      }
      renderPlan(summary);
      logger.log("");
      logger.info("Dry run. Remove --dry-run to import for real.");

      return DONE;
    }

    return {
      input: {
        ...target,
        concurrency: args.concurrency,
        wait: args.wait,
        videoTimeout: args.videoTimeout,
        processingTimeout: args.processingTimeout,
      },
      env,
      confirm:
        summary.newVideos > 0
          ? async () => {
              requireConfirmable(output, {
                force: args.force,
                message: `Importing ${summary.newVideos} videos needs a confirmation prompt.`,
                hint: "Re-run with --force to import without a prompt, or --dry-run to only show the plan.",
              });
              return confirm(
                `Import ${summary.newVideos} videos into ${library.name}?`,
                { force: args.force },
              );
            }
          : undefined,
    };
  },

  after: (result) => {
    if (result.failed.length > 0) process.exitCode = 1;
  },

  render: (result, { output }) => renderResult(result, output),
});
