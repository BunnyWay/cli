import { ApiError, UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import { defineTool } from "../define-tool.ts";

const commaList = (description: string) =>
  z.array(z.string().min(1)).optional().describe(description);

export const LogEntrySchema = z.looseObject({
  timestamp: z.string(),
  requestId: z.string(),
  cacheStatus: z.string(),
  statusCode: z.number(),
  bytesSent: z.number(),
  remoteIp: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  edgeLocation: z.string(),
  url: z.string(),
  userAgent: z.string().nullable().optional(),
  referer: z.string().nullable().optional(),
});

export const PullZoneLogsSchema = z.object({
  pullZone: z.number(),
  from: z.string(),
  to: z.string(),
  entries: z.array(LogEntrySchema),
  /** Pass as `offset` to fetch the next page; null when this is the last one. */
  nextOffset: z.number().nullable(),
});
export type PullZoneLogs = z.infer<typeof PullZoneLogsSchema>;

export const pullZonesLogs = defineTool({
  name: "pullzones.logs",
  title: "Query pull zone logs",
  description:
    "Query raw CDN request logs for a pull zone. Logs are kept for 3 days; the range defaults to the last 24 hours. Logging must be enabled on the pull zone.",
  schema: z.strictObject({
    pullZone: z
      .number()
      .int()
      .positive()
      .describe("Pull zone ID, e.g. `12345`."),
    from: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("Inclusive start, ISO 8601. Defaults to 24 hours before `to`."),
    to: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("Exclusive end, ISO 8601. Defaults to now."),
    status: commaList("HTTP status codes or classes, e.g. `404`, `5xx`."),
    cacheStatus: commaList("Cache statuses, e.g. `HIT`, `MISS`."),
    country: commaList("ISO 3166 alpha-2 country codes, e.g. `DE`."),
    urlContains: z
      .string()
      .optional()
      .describe("Case-insensitive substring of host + path."),
    search: z
      .string()
      .optional()
      .describe("Free-text tokens matched against most fields."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(100)
      .describe("Entries per page, up to 10000."),
    offset: z.number().int().min(0).default(0).describe("Entries to skip."),
    order: z.enum(["asc", "desc"]).default("desc").describe("By timestamp."),
  }),
  kind: "read",
  resultSchema: PullZoneLogsSchema,
  examples: [
    [{ pullZone: 12345 }, "Latest requests from the last 24 hours"],
    [{ pullZone: 12345, status: ["4xx", "5xx"] }, "Only errors"],
  ],
  run: async (ctx, input): Promise<PullZoneLogs> => {
    ctx.progress("Fetching logs...");
    const join = (list?: string[]) =>
      list?.length ? list.join(",") : undefined;
    try {
      const { data } = await ctx.clients.logging.GET(
        "/v2/pullzones/{pullZoneId}/logs",
        {
          params: {
            path: { pullZoneId: input.pullZone },
            query: {
              from: input.from,
              to: input.to,
              status: join(input.status),
              cacheStatus: join(input.cacheStatus),
              country: join(input.country),
              urlContains: input.urlContains,
              search: input.search,
              limit: input.limit,
              offset: input.offset,
              order: input.order,
            },
          },
          signal: ctx.signal,
        },
      );
      if (!data) throw new UserError("The logging API returned no data.");
      return {
        pullZone: input.pullZone,
        from: data.query.from,
        to: data.query.to,
        entries: data.data,
        nextOffset: data.pagination.hasMore
          ? data.pagination.offset + data.pagination.returned
          : null,
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new UserError(
          `Logging is not enabled for pull zone ${input.pullZone}, or it does not exist.`,
          "Enable logging in the pull zone's settings in the dashboard.",
        );
      }
      throw err;
    }
  },
});
