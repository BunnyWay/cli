import { pullZonesLogs } from "@bunny.net/tools/pullzones";
import { defineToolCommand } from "@/core/define-tool-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { resolvePullZoneId } from "./constants.ts";

interface LogsArgs {
  id?: number;
  from?: string;
  to?: string;
  status?: string;
  cacheStatus?: string;
  country?: string;
  url?: string;
  search?: string;
  limit: number;
  offset: number;
  order: "asc" | "desc";
}

function list(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items?.length ? items : undefined;
}

export const pzLogsCommand = defineToolCommand({
  tool: pullZonesLogs,
  command: "logs [id]",
  describe: "Show request logs for a pull zone.",
  examples: [
    ["$0 pz logs", "Latest requests for the linked pull zone"],
    ["$0 pz logs 12345 --status 4xx,5xx", "Only errors"],
    [
      "$0 pz logs 12345 --from 2026-08-08T00:00:00Z --to 2026-08-09T00:00:00Z",
      "A specific time range",
    ],
    ["$0 pz logs 12345 --limit 1000 --output json", "JSON output"],
  ],
  epilogue:
    "Logs are kept for 3 days. Logging must be enabled on the pull zone.",
  progress: "Fetching logs...",

  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "number",
        describe: "Pull zone ID (uses linked one if omitted)",
      })
      .option("from", {
        type: "string",
        describe: "Start time, ISO 8601 (default: 24h before --to)",
      })
      .option("to", {
        type: "string",
        describe: "End time, ISO 8601 (default: now)",
      })
      .option("status", {
        type: "string",
        describe: "Status codes or classes, comma separated (e.g. 404,5xx)",
      })
      .option("cache-status", {
        type: "string",
        describe: "Cache statuses, comma separated (e.g. HIT,MISS)",
      })
      .option("country", {
        type: "string",
        describe: "Country codes, comma separated (e.g. DE,US)",
      })
      .option("url", {
        type: "string",
        describe: "Only URLs containing this text",
      })
      .option("search", {
        type: "string",
        describe: "Free-text search across most fields",
      })
      .option("limit", {
        type: "number",
        default: 100,
        describe: "Entries per page (max 10000)",
      })
      .option("offset", {
        type: "number",
        default: 0,
        describe: "Entries to skip",
      })
      .option("order", {
        type: "string",
        choices: ["asc", "desc"] as const,
        default: "desc" as const,
        describe: "Sort by time",
      }),

  prepare: async (args: LogsArgs) => ({
    input: {
      pullZone: resolvePullZoneId(args.id),
      from: args.from,
      to: args.to,
      status: list(args.status),
      cacheStatus: list(args.cacheStatus),
      country: list(args.country),
      urlContains: args.url,
      search: args.search,
      limit: args.limit,
      offset: args.offset,
      order: args.order,
    },
  }),

  render: (logs, { output }) => {
    if (logs.entries.length === 0) {
      logger.info("No log entries found.");
      return;
    }

    logger.log(
      formatTable(
        ["Time", "Status", "Cache", "Country", "Edge", "URL"],
        logs.entries.map((entry) => [
          entry.timestamp,
          String(entry.statusCode),
          entry.cacheStatus,
          entry.countryCode ?? "",
          entry.edgeLocation,
          entry.url,
        ]),
        output,
      ),
    );

    if (logs.nextOffset !== null) {
      logger.dim(
        `More entries available. Next page: --offset ${logs.nextOffset}`,
      );
    }
  },
});
