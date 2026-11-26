import { readFile } from "node:fs/promises";
import { ApiError, UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { ToolContext } from "@/tools/context.ts";
import { defineTool } from "@/tools/define-tool.ts";
import { fetchLibrary } from "./api.ts";
import {
  COUNTRY_CODES,
  expandGeoPresets,
  GEO_PRESET_IDS,
  parseCountryCodes,
} from "./countries.ts";
import type { VideoLibraryModel, VideoLibraryUpdateModel } from "./model.ts";

const libraryId = z
  .number()
  .int()
  .positive()
  .describe("Video library ID, e.g. `12345`.");

async function library(
  ctx: ToolContext,
  id: number,
): Promise<VideoLibraryModel> {
  return fetchLibrary(ctx.clients.core, id, { signal: ctx.signal });
}

async function updateLibrary(
  ctx: ToolContext,
  id: number,
  body: VideoLibraryUpdateModel,
): Promise<void> {
  await ctx.clients.core.POST("/videolibrary/{id}", {
    params: { path: { id } },
    body,
    signal: ctx.signal,
  });
}

/* ------------------------------------------------------------------ */
/* Watermark                                                          */
/* ------------------------------------------------------------------ */

const percent = z.number().int().min(0).max(100);

export const WatermarkSchema = z.object({
  library: z.number(),
  enabled: z.boolean(),
  /** Offsets and size, as a percentage of the video frame. */
  left: z.number().nullable(),
  top: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});
export type Watermark = z.infer<typeof WatermarkSchema>;

export function toWatermark(lib: VideoLibraryModel): Watermark {
  return {
    library: lib.Id ?? 0,
    enabled: lib.HasWatermark ?? false,
    left: lib.WatermarkPositionLeft ?? null,
    top: lib.WatermarkPositionTop ?? null,
    width: lib.WatermarkWidth ?? null,
    height: lib.WatermarkHeight ?? null,
  };
}

export const streamWatermarkGet = defineTool({
  name: "stream.watermark.get",
  title: "Get the watermark",
  description:
    "Get whether a video library burns a watermark into new uploads, and its position and size as percentages of the frame.",
  schema: z.strictObject({ library: libraryId }),
  kind: "read",
  resultSchema: WatermarkSchema,
  run: async (ctx, { library: id }) => {
    ctx.progress("Fetching watermark...");
    return toWatermark(await library(ctx, id));
  },
});

export const streamWatermarkSet = defineTool({
  name: "stream.watermark.set",
  title: "Set the watermark",
  description:
    "Upload a watermark image and/or set its position and size (percent of the frame) for a video library. The watermark is burned in while encoding, so it applies only to videos uploaded after it is set.",
  schema: z
    .strictObject({
      library: libraryId,
      file: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Local image to upload as the watermark (PNG with transparency works best).",
        ),
      left: percent.optional().describe("Left offset, percent of the width."),
      top: percent.optional().describe("Top offset, percent of the height."),
      width: percent.optional().describe("Width, percent of the video width."),
      height: percent
        .optional()
        .describe("Height, percent of the video height."),
    })
    .refine(
      (input) =>
        input.file !== undefined ||
        [input.left, input.top, input.width, input.height].some(
          (v) => v !== undefined,
        ),
      {
        message: "pass `file` and/or at least one of left, top, width, height",
      },
    ),
  kind: "write",
  localFiles: true,
  resultSchema: WatermarkSchema,
  run: async (ctx, { library: id, file, left, top, width, height }) => {
    const bytes = file ? await readFile(file) : undefined;
    if (!bytes) {
      const current = await library(ctx, id);
      if (!current.HasWatermark) {
        throw new UserError(
          `Video library ${id} has no watermark to position.`,
          "Upload an image with `file` first.",
        );
      }
    }
    if (bytes) {
      ctx.progress("Uploading watermark...");
      try {
        await ctx.clients.core.PUT("/videolibrary/{id}/watermark", {
          params: { path: { id } },
          headers: { "Content-Type": "application/octet-stream" },
          bodySerializer: (value: unknown) => value,
          // The spec has no body for this endpoint; the image bytes are sent raw.
          body: bytes as unknown as never,
          signal: ctx.signal,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 413) {
          throw new UserError(
            "The watermark image is too large.",
            "Use a smaller image file.",
          );
        }
        throw err;
      }
    }
    const body: VideoLibraryUpdateModel = {};
    if (left !== undefined) body.WatermarkPositionLeft = left;
    if (top !== undefined) body.WatermarkPositionTop = top;
    if (width !== undefined) body.WatermarkWidth = width;
    if (height !== undefined) body.WatermarkHeight = height;
    if (Object.keys(body).length > 0) {
      ctx.progress("Positioning watermark...");
      await updateLibrary(ctx, id, body);
    }
    return toWatermark(await library(ctx, id));
  },
});

export const streamWatermarkRemove = defineTool({
  name: "stream.watermark.remove",
  title: "Remove the watermark",
  description:
    "Delete a video library's watermark image. Videos already encoded keep theirs; new uploads are encoded without one.",
  schema: z.strictObject({ library: libraryId }),
  kind: "destructive",
  resultSchema: WatermarkSchema,
  run: async (ctx, { library: id }) => {
    ctx.progress("Removing watermark...");
    await ctx.clients.core.DELETE("/videolibrary/{id}/watermark", {
      params: { path: { id } },
      signal: ctx.signal,
    });
    return toWatermark(await library(ctx, id));
  },
});

/* ------------------------------------------------------------------ */
/* Geo-blocking                                                       */
/* ------------------------------------------------------------------ */

export const GeoBlockingSchema = z.object({
  library: z.number(),
  pullZoneId: z.number(),
  /** ISO 3166-1 alpha-2 codes refused by the library's CDN; empty when geo-blocking is off. */
  blocked: z.array(z.string()),
});
export type GeoBlocking = z.infer<typeof GeoBlockingSchema>;

async function pullZoneOf(ctx: ToolContext, id: number): Promise<number> {
  const lib = await library(ctx, id);
  if (!lib.PullZoneId) {
    throw new UserError(`Video library ${id} has no linked Pull Zone.`);
  }
  return lib.PullZoneId;
}

async function readBlocked(
  ctx: ToolContext,
  pullZoneId: number,
): Promise<string[]> {
  const { data } = await ctx.clients.core.GET("/pullzone/{id}", {
    params: { path: { id: pullZoneId } },
    signal: ctx.signal,
  });
  return [...(data?.BlockedCountries ?? [])].map((c) => c.toUpperCase()).sort();
}

export const streamGeoBlockingGet = defineTool({
  name: "stream.geoblocking.get",
  title: "Get geo-blocking",
  description:
    "Get the countries a video library refuses to deliver video to. The list lives on the library's linked Pull Zone (`BlockedCountries`); the country is detected from the viewer's IP.",
  schema: z.strictObject({ library: libraryId }),
  kind: "read",
  resultSchema: GeoBlockingSchema,
  run: async (ctx, { library: id }) => {
    ctx.progress("Fetching geo-blocking...");
    const pullZoneId = await pullZoneOf(ctx, id);
    return {
      library: id,
      pullZoneId,
      blocked: await readBlocked(ctx, pullZoneId),
    };
  },
});

const countries = z
  .array(z.string())
  .describe(
    'ISO 3166-1 alpha-2 codes, e.g. `["US", "CN"]`; `UK` is accepted for `GB`.',
  );

export const streamGeoBlockingUpdate = defineTool({
  name: "stream.geoblocking.update",
  title: "Update geo-blocking",
  description:
    "Change which countries a video library refuses to deliver to. `block` and `unblock` edit the current list; `set` replaces it; `allowOnly` blocks every country except the ones given (stored as a block list of all the others); `clear` turns geo-blocking off. `presets` (e.g. `eu`, `eea-uk`, `europe`, `nordics`) add their countries to whichever of `block`, `set` or `allowOnly` is given, or to `block` on their own. Video, thumbnails and playlists are all refused, by viewer IP.",
  schema: z
    .strictObject({
      library: libraryId,
      block: countries.optional(),
      unblock: countries.optional(),
      set: countries.optional(),
      allowOnly: countries.optional(),
      clear: z.boolean().optional().describe("Unblock every country."),
      presets: z
        .array(z.string())
        .optional()
        .describe(
          `Presets whose countries are added to the list: ${GEO_PRESET_IDS.join(", ")}.`,
        ),
    })
    .refine(
      (i) =>
        [i.set, i.allowOnly, i.clear || undefined].filter(
          (v) => v !== undefined,
        ).length +
          (i.block || i.unblock || (i.presets && !i.set && !i.allowOnly)
            ? 1
            : 0) ===
        1,
      {
        message:
          "pass exactly one of: block/unblock (optionally with presets), set, allowOnly, or clear",
      },
    ),
  kind: "write",
  resultSchema: GeoBlockingSchema,
  run: async (ctx, input) => {
    // Presets only add countries, to whichever list the mode uses.
    const fromPresets = expandGeoPresets(input.presets ?? []);
    const pullZoneId = await pullZoneOf(ctx, input.library);
    let blocked: string[];
    if (input.clear) {
      blocked = [];
    } else if (input.set) {
      blocked = parseCountryCodes([...input.set, ...fromPresets]);
    } else if (input.allowOnly) {
      const allowed = new Set(
        parseCountryCodes([...input.allowOnly, ...fromPresets]),
      );
      if (allowed.size === 0)
        throw new UserError("`allowOnly` needs at least one country.");
      blocked = COUNTRY_CODES.filter((code) => !allowed.has(code));
    } else {
      const add = parseCountryCodes([...(input.block ?? []), ...fromPresets]);
      const remove = new Set(parseCountryCodes(input.unblock ?? []));
      ctx.progress("Fetching geo-blocking...");
      const current = await readBlocked(ctx, pullZoneId);
      blocked = [...new Set([...current, ...add])].filter(
        (c) => !remove.has(c),
      );
    }
    ctx.progress("Updating geo-blocking...");
    await ctx.clients.core.POST("/pullzone/{id}", {
      params: { path: { id: pullZoneId } },
      body: { BlockedCountries: blocked },
      signal: ctx.signal,
    });
    return {
      library: input.library,
      pullZoneId,
      blocked: await readBlocked(ctx, pullZoneId),
    };
  },
});
