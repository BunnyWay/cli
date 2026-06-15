import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatKeyValue, formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { renderBarChart, sumChart } from "../../../core/stats.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveZoneInteractive } from "../interactive.ts";
import { queryTypeLabel } from "../query-types.ts";

interface StatsArgs {
  domain?: string;
  from?: string;
  to?: string;
}

export const dnsStatsCommand = defineCommand<StatsArgs>({
  command: "stats [domain]",
  describe: "Show DNS query statistics for a zone.",
  examples: [
    ["$0 dns zones stats example.com", "Statistics for the last 30 days"],
    [
      "$0 dns zones stats example.com --from 2026-05-01 --to 2026-05-31",
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

    const zone = await resolveZoneInteractive(client, domain, {
      output,
      offerLink: true,
    });

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

    const byType = Object.entries(data?.QueriesByTypeChart ?? {})
      .map(([code, count]): [string, number] => [queryTypeLabel(code), count])
      .sort((a, b) => b[1] - a[1]);
    if (byType.length > 0) {
      logger.log("");
      logger.dim("  Queries by type");
      if (output === "text") {
        logger.log(renderBarChart(byType));
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
