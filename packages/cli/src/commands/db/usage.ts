import { dbUsage } from "@bunny.net/actions";
import { defineActionCommand } from "../../core/define-action-command.ts";
import { UserError } from "../../core/errors.ts";
import {
  formatBytes,
  formatDate,
  formatKeyValue,
  progressBar,
} from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { ARG_DATABASE_ID } from "./constants.ts";
import { resolveDbId } from "./resolve-db.ts";

const COMMAND = `usage [${ARG_DATABASE_ID}]`;
const DESCRIPTION = "Show usage statistics for a database.";

const ARG_FROM = "from";
const ARG_TO = "to";
const ARG_PERIOD = "period";

/**
 * Parse a period shorthand into a `from` Date.
 * Supported: 24h, 7d, 30d, this-month (default).
 */
function parsePeriod(period: string): Date {
  const now = new Date();

  switch (period) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "this-month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    default:
      throw new UserError(
        `Invalid period: "${period}"`,
        "Use 24h, 7d, 30d, or this-month.",
      );
  }
}

/** Format a number with locale-appropriate thousand separators. */
function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Display usage statistics for a database.
 *
 * Shows rows read, rows written, query count, average latency, and storage
 * utilisation (with a visual progress bar) over a configurable time range.
 *
 * Time range can be specified via `--period` shorthands (`24h`, `7d`, `30d`,
 * `this-month`) or explicit `--from` / `--to` ISO dates. Defaults to
 * `this-month`.
 *
 * @example
 * ```bash
 * # Current month (default)
 * bunny db usage
 *
 * # Last 7 days for a specific database
 * bunny db usage db_01KCHBG8C5KSFGG0VRNFQ7EK7X --period 7d
 *
 * # Custom date range
 * bunny db usage --from 2026-01-01 --to 2026-01-31
 *
 * # JSON output for scripting
 * bunny db usage --output json
 * ```
 */
export const dbUsageCommand = defineActionCommand({
  action: dbUsage,
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 db usage", "Current month usage"],
    ["$0 db usage --period 7d", "Last 7 days"],
    ["$0 db usage --from 2026-01-01 --to 2026-01-31", "Custom date range"],
    ["$0 db usage --output json", "JSON output for scripting"],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_DATABASE_ID, {
        type: "string",
        describe:
          "Database ID (db_<ulid>). Auto-detected from BUNNY_DATABASE_URL in .env if omitted.",
      })
      .option(ARG_FROM, {
        type: "string",
        describe: "Start date (ISO date or date-time)",
      })
      .option(ARG_TO, {
        type: "string",
        describe: "End date (ISO date or date-time)",
      })
      .option(ARG_PERIOD, {
        type: "string",
        choices: ["24h", "7d", "30d", "this-month"] as const,
        describe: "Time range shorthand (default: this-month)",
      }),

  progress: "Fetching usage data...",

  prepare: async (args, ctx) => {
    // --from/--to win; otherwise the period shorthand chooses the window.
    const now = new Date();
    let fromDate: Date;
    let toDate: Date;
    if (args.from) {
      fromDate = new Date(args.from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new UserError(`Invalid --from date: "${args.from}"`);
      }
      toDate = args.to ? new Date(args.to) : now;
      if (Number.isNaN(toDate.getTime())) {
        throw new UserError(`Invalid --to date: "${args.to}"`);
      }
    } else {
      fromDate = parsePeriod(args.period ?? "this-month");
      toDate = now;
    }

    const { id } = await resolveDbId(ctx.clients.db, args[ARG_DATABASE_ID]);

    return {
      input: {
        database: id,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
    };
  },

  render: (usage, { output }) => {
    const sizeFraction =
      usage.storage.maxBytes > 0
        ? usage.storage.bytes / usage.storage.maxBytes
        : 0;
    const currentSize = formatBytes(usage.storage.bytes);
    const maxSize = formatBytes(usage.storage.maxBytes);

    const entries = [
      { key: "Rows read", value: formatNumber(usage.rowsRead) },
      { key: "Rows written", value: formatNumber(usage.rowsWritten) },
      { key: "Queries", value: formatNumber(usage.queries) },
      { key: "Avg latency", value: `${usage.avgLatencyMs.toFixed(1)}ms` },
      {
        key: "Storage",
        value:
          output === "text"
            ? `${currentSize} / ${maxSize}  ${progressBar(sizeFraction)}  ${usage.storage.percent}%`
            : `${currentSize} / ${maxSize} (${usage.storage.percent}%)`,
      },
    ];

    const label = usage.name
      ? `${usage.name} (${usage.database})`
      : usage.database;
    logger.info(`Usage for ${label}`);
    logger.dim(
      `  ${formatDate(new Date(usage.from))} – ${formatDate(new Date(usage.to))}`,
    );
    logger.log();
    logger.log(formatKeyValue(entries, output));
  },
});
