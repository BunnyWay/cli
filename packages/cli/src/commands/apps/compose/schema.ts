import { z } from "zod";

/**
 * Zod schema for the subset of `docker-compose.yml` we translate.
 *
 * Uses `.loose()` everywhere so unknown fields don't fail validation.
 * We read them downstream to emit standardised warnings
 * (e.g. "Ignored `depends_on`") rather than rejecting the whole file.
 */

const BuildSchema = z.union([
  z.string(),
  z
    .object({
      context: z.string().optional(),
      dockerfile: z.string().optional(),
      args: z.record(z.string(), z.string()).optional(),
    })
    .loose(),
]);

const PortSchema = z.union([
  z.string(),
  z
    .object({
      target: z.number(),
      published: z.union([z.number(), z.string()]).optional(),
      protocol: z.string().optional(),
    })
    .loose(),
]);

const VolumeMountSchema = z.union([
  z.string(),
  z
    .object({
      type: z.string(),
      source: z.string().optional(),
      target: z.string(),
      read_only: z.boolean().optional(),
    })
    .loose(),
]);

const EnvSchema = z.union([
  z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  z.array(z.string()),
]);

const HealthcheckSchema = z
  .object({
    test: z.union([z.string(), z.array(z.string())]).optional(),
    interval: z.string().optional(),
    timeout: z.string().optional(),
    retries: z.number().optional(),
    disable: z.boolean().optional(),
  })
  .loose();

export const ComposeServiceSchema = z
  .object({
    image: z.string().optional(),
    build: BuildSchema.optional(),
    command: z.union([z.string(), z.array(z.string())]).optional(),
    environment: EnvSchema.optional(),
    env_file: z.union([z.string(), z.array(z.string())]).optional(),
    ports: z.array(PortSchema).optional(),
    volumes: z.array(VolumeMountSchema).optional(),
    healthcheck: HealthcheckSchema.optional(),
  })
  .loose();

export const ComposeFileSchema = z
  .object({
    services: z.record(z.string(), ComposeServiceSchema),
    volumes: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export type ComposeFile = z.infer<typeof ComposeFileSchema>;
export type ComposeService = z.infer<typeof ComposeServiceSchema>;
