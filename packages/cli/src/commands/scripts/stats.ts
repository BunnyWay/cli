import { createComputeClient } from "@bunny.net/openapi-client";
import chalk from "chalk";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { bunny } from "../../core/colors.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatKeyValue, formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { resolveManifestId } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import { fetchScript } from "./api.ts";
import { SCRIPT_MANIFEST } from "./constants.ts";

interface StatsArgs {
  id?: number;
  from?: string;
  to?: string;
  hourly?: boolean;
}

const BAR_WIDTH = 24;

// TODO(#91): lift renderBarChart/BAR_WIDTH into core/stats.ts and share with dns/zone/stats.ts once feat/dns lands.

/** Render a horizontal bar chart from a list of [label, value] pairs. */
function renderBarChart(rows: [string, number][]): string {
  const max = Math.max(...rows.map(([, n]) => n), 1);
  const labelWidth = Math.max(...rows.map(([l]) => l.length));
  const numWidth = Math.max(...rows.map(([, n]) => n.toLocaleString().length));
  return rows
    .map(([label, value]) => {
      const filled =
        value > 0 ? Math.max(1, Math.round((value / max) * BAR_WIDTH)) : 0;
      const bar =
        bunny("█".repeat(filled)) + chalk.gray("░".repeat(BAR_WIDTH - filled));
      const name = label.padEnd(labelWidth);
      const num = value.toLocaleString().padStart(numWidth);
      return `  ${name}  ${bar}  ${num}`;
    })
    .join("\n");
}

/**
 * Show usage statistics for an Edge Script.
 *
 * Displays request, CPU, and cost totals over the period, plus a per-bucket
 * requests-served bar chart. Falls back to the linked script ID from the local
 * manifest when no explicit ID is provided.
 *
 * @example
 * ```bash
 * # Stats for the linked script (last 30 days)
 * bunny scripts stats
 *
 * # Stats for a specific script over a date range
 * bunny scripts stats 12345 --from 2026-05-01 --to 2026-05-31
 *
 * # Hourly grouping, JSON output
 * bunny scripts stats 12345 --hourly --output json
 * ```
 */
export const scriptsStatsCommand = defineCommand<StatsArgs>({
  command: "stats [id]",
  describe: "Show usage statistics for an Edge Script.",
  examples: [
    ["$0 scripts stats", "Stats for the linked script (last 30 days)"],
    [
      "$0 scripts stats 12345 --from 2026-05-01 --to 2026-05-31",
      "Stats over a date range",
    ],
    ["$0 scripts stats 12345 --hourly", "Hourly grouping"],
  ],

  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "number",
        describe: "Edge Script ID (uses linked script if omitted)",
      })
      .option("from", {
        type: "string",
        describe: "Start date (YYYY-MM-DD); defaults to 30 days ago",
      })
      .option("to", {
        type: "string",
        describe: "End date (YYYY-MM-DD); defaults to today",
      })
      .option("hourly", {
        type: "boolean",
        describe: "Group statistics by hour instead of by day",
      }),

  handler: async ({
    id: rawId,
    from,
    to,
    hourly,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const id = resolveManifestId(SCRIPT_MANIFEST, rawId, "script");
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const spin = spinner("Fetching statistics...");
    spin.start();

    const script = await fetchScript(client, id);
    const { data } = await client.GET("/compute/script/{id}/statistics", {
      params: {
        path: { id },
        query: { dateFrom: from, dateTo: to, hourly },
      },
    });

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify(data ?? {}, null, 2));
      return;
    }

    const period =
      from || to ? `${from ?? "…"} → ${to ?? "today"}` : "last 30 days";
    logger.log(
      formatKeyValue(
        [
          { key: "Script", value: script.Name ?? String(id) },
          { key: "Period", value: period },
          {
            key: "Total Requests",
            value: (data?.TotalRequestsServed ?? 0).toLocaleString(),
          },
          {
            key: "Total CPU",
            value: `${(data?.TotalCpuUsed ?? 0).toLocaleString()}ms`,
          },
          {
            key: "Avg CPU / Execution",
            value: `${(data?.AverageCpuTimePerExecution ?? 0).toFixed(2)}ms`,
          },
          {
            key: "Total Cost",
            value: `$${(data?.TotalMonthlyCost ?? 0).toFixed(2)}`,
          },
        ],
        output,
      ),
    );

    const requests = Object.entries(data?.RequestsServedChart ?? {}).sort(
      (a, b) => a[0].localeCompare(b[0]),
    );
    if (requests.length > 0) {
      logger.log("");
      logger.dim("  Requests served");
      if (output === "text") {
        logger.log(renderBarChart(requests));
      } else {
        logger.log(
          formatTable(
            ["Bucket", "Requests"],
            requests.map(([bucket, count]) => [bucket, String(count)]),
            output,
          ),
        );
      }
    }
  },
});
