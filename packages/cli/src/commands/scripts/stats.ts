import { createComputeClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatKeyValue, formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { formatBucketLabel, renderBarChart } from "../../core/stats.ts";
import { spinner } from "../../core/ui.ts";
import {
  type ScriptSelectorArgs,
  scriptSelectorBuilder,
  selectScript,
} from "./interactive.ts";

interface StatsArgs extends ScriptSelectorArgs {
  from?: string;
  to?: string;
  hourly?: boolean;
}

/**
 * Show usage statistics for an Edge Script.
 *
 * Displays request, CPU, and cost totals over the period, plus a per-bucket
 * requests-served bar chart. When no ID is given it falls back to the linked
 * script from the local manifest, then to an interactive picker (offering to
 * link the directory for next time).
 *
 * @example
 * ```bash
 * # Stats for the linked script, or pick one interactively (last 30 days)
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
    scriptSelectorBuilder(yargs)
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
    link,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const { script, id, offerLink } = await selectScript(client, {
      id: rawId,
      link,
      output,
    });

    const spin = spinner("Fetching statistics...");
    spin.start();

    const { data } = await client
      .GET("/compute/script/{id}/statistics", {
        params: {
          path: { id },
          query: { dateFrom: from, dateTo: to, hourly },
        },
      })
      .finally(() => spin.stop());

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
        logger.log(
          renderBarChart(
            requests.map(([bucket, count]) => [
              formatBucketLabel(bucket, hourly),
              count,
            ]),
          ),
        );
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

    await offerLink();
  },
});
