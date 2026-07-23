import { z } from "zod";
import type { ContainerRegistryModel } from "./api.ts";

/** Stable, credential-free view of a container registry. */
export const RegistrySchema = z.object({
  id: z.number(),
  name: z.string(),
  hostname: z.string().nullable(),
  username: z.string().nullable(),
  createdAt: z.string().nullable(),
  lastUpdatedAt: z.string().nullable(),
});

export type Registry = z.infer<typeof RegistrySchema>;

export function toRegistry(registry: ContainerRegistryModel): Registry {
  return {
    id: registry.id ?? 0,
    name: registry.displayName ?? "",
    hostname: registry.hostName || null,
    username: registry.userName ?? null,
    createdAt: registry.createdAt ?? null,
    lastUpdatedAt: registry.lastUpdatedAt ?? null,
  };
}
