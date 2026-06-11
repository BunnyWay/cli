import { BunnyAppConfigSchema } from "@bunny.net/app-config";
import { z } from "zod";

export const CURRENT_VERSION = "2026-06-10";

const VersionSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "version must be an ISO date string (YYYY-MM-DD)",
  );

/** Binding keys double as identifiers in tooling, so keep them slug-shaped. */
export const BindingNameSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]*$/,
    "binding names must start with a letter and contain only letters, digits, '_' or '-'",
  );

/** A Magic Containers database this project uses (`id` is the v2 database UUID). */
export const DatabaseBindingSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

/** An Edge Script this project uses; `entry` is a local-dev hint, not deploy intent. */
export const ScriptBindingSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  type: z.enum(["standalone", "middleware", "dns"]).optional(),
  entry: z.string().optional(),
});

/**
 * The `bunny.jsonc` document: a map from binding names to bunny.net resources
 * a project uses. The `app` block is the Magic Containers config (owned by
 * `@bunny.net/app-config`) embedded so one file validates for both; future
 * resource blocks (storage, pullzones, dns) slot in as sibling records.
 */
export const BunnyProjectConfigSchema = z.object({
  $schema: z.string().optional(),
  version: VersionSchema,
  name: z.string().optional(),
  databases: z.record(BindingNameSchema, DatabaseBindingSchema).optional(),
  scripts: z.record(BindingNameSchema, ScriptBindingSchema).optional(),
  app: BunnyAppConfigSchema.shape.app.optional(),
});

export type BunnyProjectConfig = z.infer<typeof BunnyProjectConfigSchema>;
export type DatabaseBinding = z.infer<typeof DatabaseBindingSchema>;
export type ScriptBinding = z.infer<typeof ScriptBindingSchema>;
export type ResourceKind = "databases" | "scripts";
export type ScriptBindingType = NonNullable<ScriptBinding["type"]>;
