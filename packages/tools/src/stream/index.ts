import { UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { StreamClient, ToolContext } from "../context.ts";
import type { Tool } from "../define-tool.ts";
import { defineTool } from "../define-tool.ts";
import { fetchAccountId, fetchLibraries, resolveLibrary } from "./api.ts";
import {
  type StreamLibrary,
  StreamLibrarySchema,
  toStreamLibrary,
} from "./model.ts";

export type { VideoLibraryModel } from "./api.ts";
export type { StreamLibrary } from "./model.ts";
export { StreamLibrarySchema, toStreamLibrary } from "./model.ts";

export const streamLibrariesList = defineTool({
  name: "stream.libraries.list",
  title: "List video libraries",
  description:
    "List the Stream video libraries on the account, sorted by name.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(StreamLibrarySchema),
  run: async (ctx): Promise<StreamLibrary[]> => {
    ctx.progress("Fetching video libraries...");
    const libraries = await fetchLibraries(ctx.clients.core, {
      signal: ctx.signal,
    });
    return libraries.map(toStreamLibrary);
  },
});

export const streamLibrariesGet = defineTool({
  name: "stream.libraries.get",
  title: "Get a video library",
  description:
    "Get one Stream video library by ID, or by its exact name (case-insensitive).",
  schema: z.strictObject({
    library: z
      .string()
      .min(1)
      .describe("Library ID, e.g. `12345`, or its exact name."),
  }),
  kind: "read",
  resultSchema: StreamLibrarySchema,
  examples: [[{ library: "12345" }, "Show one library"]],
  run: async (ctx, { library }): Promise<StreamLibrary> => {
    ctx.progress("Fetching video library...");
    return toStreamLibrary(
      await resolveLibrary(ctx.clients.core, library, { signal: ctx.signal }),
    );
  },
});

export interface StreamLibraryConnection {
  library: StreamLibrary;
  accountId: string;
  /** Authenticated with the library's own Stream key, which never leaves this object. */
  client: StreamClient;
}

/** Resolve a library by name or ID and open a Stream client on it; not a tool, since a live client is not serializable. */
export async function openStreamLibrary(
  ctx: ToolContext,
  nameOrId: string | number,
): Promise<StreamLibraryConnection> {
  const [model, accountId] = await Promise.all([
    resolveLibrary(ctx.clients.core, nameOrId, { signal: ctx.signal }),
    fetchAccountId(ctx.clients.core, { signal: ctx.signal }),
  ]);
  const library = toStreamLibrary(model);
  if (!model.ApiKey) {
    throw new UserError(
      `No API key available for video library ${library.name || library.id}.`,
      "Video operations need the library's own Stream API key; check that the account key can read it.",
    );
  }
  return {
    library,
    accountId,
    client: ctx.clients.streamLibrary(model.ApiKey),
  };
}

export const streamTools: Tool[] = [streamLibrariesList, streamLibrariesGet];
