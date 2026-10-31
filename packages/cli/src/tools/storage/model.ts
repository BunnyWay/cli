import type { components } from "@bunny.net/openapi-client/core";
import { z } from "zod";

export type StorageRegionModel = components["schemas"]["StorageRegionModel"];

export const StorageRegionOptionSchema = z.object({
  code: z.string(),
  name: z.string(),
  continent: z.string().nullable(),
  tier: z.enum(["hdd", "ssd"]),
  main: z.boolean().describe("Can be a zone's main region on this tier."),
  s3: z.boolean().describe("Available to S3-compatible zones."),
  pricePerGigabyte: z.number().nullable(),
  endpoint: z.string().nullable(),
  s3Endpoint: z.string().nullable(),
});

export type StorageRegionOption = z.infer<typeof StorageRegionOptionSchema>;

export function toStorageRegionOption(
  region: StorageRegionModel,
): StorageRegionOption {
  return {
    code: region.Code ?? "",
    name: region.Name ?? region.Code ?? "",
    continent: region.Continent ?? null,
    tier: region.Tier === 1 ? "ssd" : "hdd",
    main: region.IsMainRegionSupported ?? false,
    s3: region.IsS3Supported ?? false,
    pricePerGigabyte: region.PricePerGigabyte ?? null,
    endpoint: region.Endpoint ?? null,
    s3Endpoint: region.S3Endpoint ?? null,
  };
}
