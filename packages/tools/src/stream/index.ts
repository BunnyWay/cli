import { z } from "zod";
import type { Tool } from "../define-tool.ts";
import { defineTool } from "../define-tool.ts";
import { fetchLibraries, resolveLibrary } from "./api.ts";
import { streamImportTools } from "./import/index.ts";
import {
  type StreamLibrary,
  StreamLibrarySchema,
  toStreamLibrary,
} from "./model.ts";

export type { VideoLibraryModel } from "./api.ts";
export * from "./import/index.ts";
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

export const streamTools: Tool[] = [
  streamLibrariesList,
  streamLibrariesGet,
  ...streamImportTools,
];
