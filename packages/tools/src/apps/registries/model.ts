import { z } from "zod";
import type { ContainerRegistryModel } from "./api.ts";

/** Stable, credential-free view of a container registry. */
export const RegistrySchema = z.object({
  id: z.number(),
  name: z.string(),
  hostname: z.string().nullable(),
  username: z.string().nullable(),
  /** True for registries bunny.net provides to every account, which cannot be edited or removed. */
  platformManaged: z.boolean(),
  /** True when the registry is pulled from without credentials. */
  public: z.boolean(),
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
    platformManaged: registry.isPlatformManaged ?? false,
    public: registry.isPublic ?? false,
    createdAt: registry.createdAt ?? null,
    lastUpdatedAt: registry.lastUpdatedAt ?? null,
  };
}
