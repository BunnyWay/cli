import chalk from "chalk";
import { defineCommand } from "../../core/define-command.ts";
import { resolveConfig } from "../../config/index.ts";
import { createDbClient } from "@bunny.net/api";
import { resolveDbId } from "./resolve-db.ts";
import { spinner } from "../../core/ui.ts";
import { logger } from "../../core/logger.ts";
import { UserError } from "../../core/errors.ts";
import { formatDate, formatKeyValue, parseSizeToBytes, progressBar } from "../../core/format.ts";
import { ARG_DATABASE_ID } from "./constants.ts";
import { clientOptions } from "../../core/client-options.ts";

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

/** Sum all datapoints in a chart's data array. */
function sumDatapoints(data: (string | number)[][]): number {
  return data.reduce((sum, point) => sum + (Number(point[1]) || 0), 0);
}

/** Format a number with locale-appropriate thousand separators. */
function formatNumber(n: number): string {
  return n.toLocaleString();
}


interface UsageArgs {
  [ARG_DATABASE_ID]?: string;
  [ARG_FROM]?: string;
  [ARG_TO]?: string;
  [ARG_PERIOD]?: string;
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
export const dbUsageCommand = defineCommand<UsageArgs>({
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

  handler: async ({
    [ARG_DATABASE_ID]: databaseIdArg,
    from: fromArg,
    to: toArg,
    period,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createDbClient(clientOptions(config, verbose));

    // Resolve time range
    const now = new Date();
    let fromDate: Date;
    let toDate: Date;

    if (fromArg) {
      fromDate = new Date(fromArg);
      if (isNaN(fromDate.getTime())) {
        throw new UserError(`Invalid --from date: "${fromArg}"`);
      }
      toDate = toArg ? new Date(toArg) : now;
      if (isNaN(toDate.getTime())) {
        throw new UserError(`Invalid --to date: "${toArg}"`);
      }
    } else {
      fromDate = parsePeriod(period ?? "this-month");
      toDate = now;
    }

    const { id: databaseId, source } = await resolveDbId(client, databaseIdArg);

    // Fetch statistics and database details in parallel
    const spin = spinner("Fetching usage data...");
    spin.start();

    const [statsResult, dbResult] = await Promise.all([
      client.GET("/v2/databases/{db_id}/statistics", {
        params: {
          path: { db_id: databaseId },
          query: {
            from: fromDate.toISOString(),
            to: toDate.toISOString(),
          },
        },
      }),
      client.GET("/v2/databases/{db_id}", {
        params: { path: { db_id: databaseId } },
      }),
    ]);

    spin.stop();

    const stats = statsResult.data;
    const db = dbResult.data?.db;

    if (!stats) {
      throw new UserError("Could not fetch usage statistics.");
    }

    // Sum time-series datapoints into totals
    const rowsRead = sumDatapoints(stats.row_read_count.data);
    const rowsWritten = sumDatapoints(stats.row_write_count.data);
    const queries = sumDatapoints(stats.query_count.data);

    // Compute average latency across all regions
    const latencyEntries = Object.values(stats.latency.data);
    let avgLatency = 0;
    if (latencyEntries.length > 0) {
      const allLatencyPoints = latencyEntries.flatMap((r) => r.data);
      const nonZero = allLatencyPoints.filter(
        (point) => Number(point[1]) > 0,
      );
      if (nonZero.length > 0) {
        avgLatency =
          nonZero.reduce((sum, point) => sum + Number(point[1]), 0) /
          nonZero.length;
      }
    }

    // Storage from database details (current_size/size_max are human-readable strings like "20.5 KB")
    const currentSize = db?.current_size ?? "0 B";
    const maxSize = db?.size_max ?? "0 B";
    const sizeBytes = parseSizeToBytes(currentSize);
    const maxBytes = parseSizeToBytes(maxSize);
    const sizeFraction = maxBytes > 0 ? sizeBytes / maxBytes : 0;
    const sizePercent = Math.round(sizeFraction * 100);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            db_id: databaseId,
            name: db?.name ?? null,
            from: fromDate.toISOString(),
            to: toDate.toISOString(),
            rows_read: rowsRead,
            rows_written: rowsWritten,
            queries,
            avg_latency_ms: Math.round(avgLatency * 100) / 100,
            storage: {
              current: sizeBytes,
              max: maxBytes,
              current_formatted: currentSize,
              max_formatted: maxSize,
              percent: sizePercent,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    const label = db?.name ? `${db.name} (${databaseId})` : databaseId;
    const range = `${formatDate(fromDate)} – ${formatDate(toDate)}`;
    const storagePlain = `${currentSize} / ${maxSize} (${sizePercent}%)`;

    const entries = [
      { key: "Rows read", value: formatNumber(rowsRead) },
      { key: "Rows written", value: formatNumber(rowsWritten) },
      { key: "Queries", value: formatNumber(queries) },
      { key: "Avg latency", value: `${avgLatency.toFixed(1)}ms` },
      { key: "Storage", value: output === "text"
        ? `${currentSize} / ${maxSize}  ${progressBar(sizeFraction)}  ${sizePercent}%`
        : storagePlain,
      },
    ];

    logger.info(`Usage for ${label}`);
    logger.dim(`  ${range}`);
    if (source === "env") {
      logger.dim("  Resolved from .env");
    }
    logger.log();
    logger.log(formatKeyValue(entries, output));
  },
});
