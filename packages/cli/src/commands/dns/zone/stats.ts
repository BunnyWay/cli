import { createCoreClient } from "@bunny.net/openapi-client";
import chalk from "chalk";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { bunny } from "../../../core/colors.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatKeyValue, formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveZoneInteractive } from "../interactive.ts";

interface StatsArgs {
  domain?: string;
  from?: string;
  to?: string;
}

const BAR_WIDTH = 24;

/** Sum the values of a date-keyed chart map. */
function sumChart(chart: { [key: string]: number } | null | undefined): number {
  return Object.values(chart ?? {}).reduce((acc, n) => acc + n, 0);
}

/** Render a horizontal bar chart of query counts per record type. */
function renderTypeChart(byType: [string, number][]): string {
  const max = Math.max(...byType.map(([, n]) => n), 1);
  const labelWidth = Math.max(...byType.map(([t]) => t.length));
  const numWidth = Math.max(
    ...byType.map(([, n]) => n.toLocaleString().length),
  );
  return byType
    .map(([type, count]) => {
      const filled =
        count > 0 ? Math.max(1, Math.round((count / max) * BAR_WIDTH)) : 0;
      const bar =
        bunny("█".repeat(filled)) + chalk.gray("░".repeat(BAR_WIDTH - filled));
      const label = type.padEnd(labelWidth);
      const value = count.toLocaleString().padStart(numWidth);
      return `  ${label}  ${bar}  ${value}`;
    })
    .join("\n");
}

export const dnsStatsCommand = defineCommand<StatsArgs>({
  command: "stats [domain]",
  describe: "Show DNS query statistics for a zone.",
  examples: [
    ["$0 dns zone stats example.com", "Statistics for the last 30 days"],
    [
      "$0 dns zone stats example.com --from 2026-05-01 --to 2026-05-31",
      "Statistics for a date range",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .option("from", {
        type: "string",
        describe: "Start date (YYYY-MM-DD); defaults to 30 days ago",
      })
      .option("to", {
        type: "string",
        describe: "End date (YYYY-MM-DD); defaults to today",
      }),

  handler: async ({ domain, from, to, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain);

    const spin = spinner("Fetching statistics...");
    spin.start();
    const { data } = await client.GET("/dnszone/{id}/statistics", {
      params: {
        path: { id: zone.Id as number },
        query: { dateFrom: from, dateTo: to },
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
          { key: "Zone", value: zone.Domain ?? "" },
          { key: "Period", value: period },
          {
            key: "Total queries",
            value: (data?.TotalQueriesServed ?? 0).toLocaleString(),
          },
          {
            key: "Normal queries",
            value: sumChart(data?.NormalQueriesServedChart).toLocaleString(),
          },
          {
            key: "Smart queries",
            value: sumChart(data?.SmartQueriesServedChart).toLocaleString(),
          },
        ],
        output,
      ),
    );

    const byType = Object.entries(data?.QueriesByTypeChart ?? {}).sort(
      (a, b) => b[1] - a[1],
    );
    if (byType.length > 0) {
      logger.log("");
      logger.dim("  Queries by type");
      if (output === "text") {
        logger.log(renderTypeChart(byType));
      } else {
        logger.log(
          formatTable(
            ["Type", "Queries"],
            byType.map(([type, count]) => [type, String(count)]),
            output,
          ),
        );
      }
    }
  },
});
