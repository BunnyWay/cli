import { ApiError, UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { CoreClient } from "../context.ts";
import type { Tool } from "../define-tool.ts";
import { defineTool } from "../define-tool.ts";
import { type PullZone, PullZoneSchema, toPullZone } from "./model.ts";

export type { PullZone, PullZoneModel } from "./model.ts";
export { PullZoneSchema, toPullZone } from "./model.ts";

const pullZoneRef = z
  .number()
  .int()
  .positive()
  .describe("Pull zone ID, e.g. `12345`.");

async function fetchPullZone(
  client: CoreClient,
  id: number,
  signal?: AbortSignal,
): Promise<PullZone> {
  try {
    const { data } = await client.GET("/pullzone/{id}", {
      params: { path: { id } },
      signal,
    });
    if (data) return toPullZone(data);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
  throw new UserError(`Pull zone ${id} not found.`);
}

export const pullZonesList = defineTool({
  name: "pullzones.list",
  title: "List pull zones",
  description: "List the pull zones on the account, sorted by name.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(PullZoneSchema),
  run: async (ctx): Promise<PullZone[]> => {
    ctx.progress("Fetching pull zones...");
    const { data } = await ctx.clients.core.GET("/pullzone", {
      signal: ctx.signal,
    });
    return (data ?? [])
      .map(toPullZone)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const pullZonesGet = defineTool({
  name: "pullzones.get",
  title: "Get a pull zone",
  description: "Get one pull zone by ID.",
  schema: z.strictObject({ pullZone: pullZoneRef }),
  kind: "read",
  resultSchema: PullZoneSchema,
  examples: [[{ pullZone: 12345 }, "Show one pull zone"]],
  run: async (ctx, { pullZone }): Promise<PullZone> => {
    ctx.progress("Fetching pull zone...");
    return fetchPullZone(ctx.clients.core, pullZone, ctx.signal);
  },
});

export const pullZonesCreate = defineTool({
  name: "pullzones.create",
  title: "Create a pull zone",
  description:
    "Create a pull zone that caches content from an origin URL. `https://` is prepended when the origin has no scheme.",
  schema: z.strictObject({
    name: z.string().min(1).describe("Pull zone name."),
    origin: z
      .string()
      .min(1)
      .describe("Origin URL, e.g. `https://origin.example.com`."),
  }),
  kind: "write",
  resultSchema: PullZoneSchema,
  examples: [
    [
      { name: "my-zone", origin: "https://origin.example.com" },
      "Create a pull zone",
    ],
  ],
  run: async (ctx, { name, origin }): Promise<PullZone> => {
    ctx.progress("Creating pull zone...");
    const { data } = await ctx.clients.core.POST("/pullzone", {
      body: {
        Name: name,
        OriginUrl: /^https?:\/\//.test(origin) ? origin : `https://${origin}`,
      },
      signal: ctx.signal,
    });
    if (!data) throw new UserError(`Failed to create pull zone ${name}.`);
    return toPullZone(data);
  },
});

export const DeletedPullZoneSchema = z.object({
  id: z.number(),
  deleted: z.literal(true),
});
export type DeletedPullZone = z.infer<typeof DeletedPullZoneSchema>;

export const pullZonesDelete = defineTool({
  name: "pullzones.delete",
  title: "Delete a pull zone",
  description:
    "Delete a pull zone. Its hostnames stop serving immediately; this cannot be undone.",
  schema: z.strictObject({ pullZone: pullZoneRef }),
  kind: "destructive",
  resultSchema: DeletedPullZoneSchema,
  examples: [[{ pullZone: 12345 }, "Delete a pull zone"]],
  run: async (ctx, { pullZone }): Promise<DeletedPullZone> => {
    ctx.progress("Deleting pull zone...");
    await ctx.clients.core.DELETE("/pullzone/{id}", {
      params: { path: { id: pullZone } },
      signal: ctx.signal,
    });
    return { id: pullZone, deleted: true };
  },
});

export const PurgedPullZoneSchema = z.object({
  id: z.number(),
  purged: z.literal(true),
});
export type PurgedPullZone = z.infer<typeof PurgedPullZoneSchema>;

export const pullZonesPurge = defineTool({
  name: "pullzones.purge",
  title: "Purge a pull zone cache",
  description:
    "Purge every cached file for a pull zone, so the next requests go back to the origin.",
  schema: z.strictObject({ pullZone: pullZoneRef }),
  kind: "write",
  resultSchema: PurgedPullZoneSchema,
  examples: [[{ pullZone: 12345 }, "Purge the cache"]],
  run: async (ctx, { pullZone }): Promise<PurgedPullZone> => {
    ctx.progress("Purging cache...");
    await ctx.clients.core.POST("/pullzone/{id}/purgeCache", {
      params: { path: { id: pullZone } },
      signal: ctx.signal,
    });
    return { id: pullZone, purged: true };
  },
});

export const pullZonesTools: Tool[] = [
  pullZonesList,
  pullZonesGet,
  pullZonesCreate,
  pullZonesDelete,
  pullZonesPurge,
];
