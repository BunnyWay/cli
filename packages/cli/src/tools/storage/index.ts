import { UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { CoreClient } from "@/tools/context.ts";
import { defineTool } from "@/tools/define-tool.ts";
import {
  type StorageRegionOption,
  StorageRegionOptionSchema,
  toStorageRegionOption,
} from "./model.ts";

export type { StorageRegionModel, StorageRegionOption } from "./model.ts";
export { StorageRegionOptionSchema, toStorageRegionOption } from "./model.ts";

export async function fetchStorageRegions(
  client: CoreClient,
  signal?: AbortSignal,
): Promise<StorageRegionOption[]> {
  const { data } = await client.GET("/storagezone/regions", { signal });
  const regions = (data ?? [])
    .filter((region) => region.Code)
    .map(toStorageRegionOption);
  if (regions.length === 0) {
    throw new UserError(
      "Could not load storage regions.",
      "The regions API returned none; try again shortly.",
    );
  }
  return regions;
}

export const storageRegionsList = defineTool({
  name: "storage.regions",
  title: "List storage regions",
  description:
    "List storage regions per tier, with whether each can be a main region and supports S3.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(StorageRegionOptionSchema),
  run: async (ctx): Promise<StorageRegionOption[]> => {
    ctx.progress("Fetching storage regions...");
    return fetchStorageRegions(ctx.clients.core, ctx.signal);
  },
});
