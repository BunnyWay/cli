import type { components } from "@bunny.net/openapi-client/core";
import { z } from "zod";
import type { CoreClient } from "@/tools/context.ts";
import { defineTool } from "@/tools/define-tool.ts";

export type StorageRegionModel = components["schemas"]["StorageRegionModel"];

export async function fetchStorageRegions(
  client: CoreClient,
  signal?: AbortSignal,
): Promise<StorageRegionModel[]> {
  const { data } = await client.GET("/storagezone/regions", { signal });
  return (data ?? []).filter((region) => region.Code);
}

export const storageRegionsList = defineTool({
  name: "storage.regions",
  title: "List storage regions",
  description:
    "List storage regions per tier, with whether each can be a main region and supports S3.",
  schema: z.strictObject({}),
  kind: "read",
  run: async (ctx): Promise<StorageRegionModel[]> => {
    ctx.progress("Fetching storage regions...");
    return fetchStorageRegions(ctx.clients.core, ctx.signal);
  },
});
