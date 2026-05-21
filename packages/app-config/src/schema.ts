import { z } from "zod";

export const CURRENT_VERSION = "2026-05-11";

const VersionSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "version must be an ISO date string (YYYY-MM-DD)",
  );

export const ProbeConfigSchema = z.object({
  type: z.enum(["http", "tcp", "grpc"]),
  path: z.string().optional(),
  port: z.number().optional(),
});

export const EndpointConfigSchema = z.object({
  type: z.enum(["cdn", "anycast"]),
  ssl: z.boolean().optional(),
  ports: z
    .array(z.object({ public: z.number(), container: z.number() }))
    .optional(),
});

export const VolumeConfigSchema = z.object({
  name: z.string(),
  mount: z.string(),
  size: z.number(),
});

export const ContainerConfigSchema = z.object({
  image: z.string().optional(),
  dockerfile: z.string().optional(),
  context: z.string().optional(),
  command: z.array(z.string()).optional(),
  registry: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  probes: z
    .object({
      readiness: ProbeConfigSchema.optional(),
      liveness: ProbeConfigSchema.optional(),
      startup: ProbeConfigSchema.optional(),
    })
    .optional(),
  endpoints: z.array(EndpointConfigSchema).optional(),
  volumes: z.array(VolumeConfigSchema).optional(),
});

/**
 * Regions can be specified two ways:
 *
 *   "regions": ["sfo", "lhr"]
 *
 *   or, for the rare case where you need to distinguish "regions bunny.net
 *   is allowed to use" from "regions bunny.net must always have running":
 *
 *   "regions": { "allowed": ["sfo", "lhr", "nyc"], "required": ["sfo"] }
 *
 * Both forms accept the same downstream conversion via `normalizeRegions`.
 */
export const RegionsConfigSchema = z.union([
  z.array(z.string()),
  z.object({
    allowed: z.array(z.string()).optional(),
    required: z.array(z.string()).optional(),
  }),
]);

export const BunnyAppConfigSchema = z.object({
  $schema: z.string().optional(),
  version: VersionSchema,
  app: z.object({
    id: z.string().optional(),
    name: z.string(),
    scaling: z.object({ min: z.number(), max: z.number() }).optional(),
    regions: RegionsConfigSchema.optional(),
    containers: z.record(z.string(), ContainerConfigSchema),
  }),
});

export type BunnyAppConfig = z.infer<typeof BunnyAppConfigSchema>;
export type ContainerConfig = z.infer<typeof ContainerConfigSchema>;
export type EndpointConfig = z.infer<typeof EndpointConfigSchema>;
export type VolumeConfig = z.infer<typeof VolumeConfigSchema>;
export type ProbeConfig = z.infer<typeof ProbeConfigSchema>;
export type RegionsConfig = z.infer<typeof RegionsConfigSchema>;

/**
 * Normalize either regions shape into `{ allowed, required }` for the API.
 *
 * - Array form → both `allowed` and `required` are the same list (the user's
 *   intent is "deploy to these regions, and they are required").
 * - Object form → passed through, with empty arrays as defaults.
 */
export function normalizeRegions(regions: RegionsConfig | undefined): {
  allowed: string[];
  required: string[];
} {
  if (!regions) return { allowed: [], required: [] };
  if (Array.isArray(regions)) {
    return { allowed: [...regions], required: [...regions] };
  }
  return {
    allowed: regions.allowed ?? [],
    required: regions.required ?? [],
  };
}
