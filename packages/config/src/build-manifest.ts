import { z } from "zod";

/**
 * The build manifest: `.bunny/build.json`, written by a framework adapter and
 * read by the CLI command that deploys that framework.
 *
 * This file is the whole contract between the CLI and an adapter. The CLI knows
 * no framework: it reads the manifest, so a new adapter needs no new CLI. The
 * specification lives beside the adapters, at
 * https://github.com/BunnyWay/bunny-adapters/blob/main/docs/writing-an-adapter.md
 */

/** Where an adapter writes the manifest, relative to the project root. */
export const BUILD_MANIFEST_PATH = ".bunny/build.json";

/**
 * The manifest shape this CLI understands.
 *
 * Bump it only for a change an older CLI cannot read. A new optional field is
 * not one: the CLI ignores what it does not know, so adapters can add fields
 * without waiting for a release.
 */
export const BUILD_MANIFEST_VERSION = 1;

/** A variable the script reads. The CLI sets what it can, and names the rest. */
export const ManifestEnvSchema = z.object({
  name: z.string(),
  reason: z.string().optional(),
  secret: z.boolean().optional(),
  optional: z.boolean().optional(),
});

/**
 * Pull zone settings the build needs.
 *
 * A framework that renders per request usually needs both of these. The CLI
 * applies them, reports every change, and never changes one back in silence.
 */
export const ManifestPullZoneSchema = z.object({
  /** `false` lets `Set-Cookie` through. A script-backed zone strips it by default. */
  disableCookies: z.boolean().optional(),
  /** `false` lets the pull zone cache HTML, so the adapter's cache headers count. */
  enableSmartCache: z.boolean().optional(),
  /** `true` fetches a large object in chunks, so the first request is seekable. */
  enableCacheSlice: z.boolean().optional(),
});

export const ManifestRequiresSchema = z.object({
  /** The lowest CLI version that understands this build, as a semver range. */
  cliVersion: z.string().optional(),
  pullZone: ManifestPullZoneSchema.optional(),
  /** The script writes to the storage zone, so it needs a password that can write. */
  storage: z
    .object({ write: z.boolean().optional(), reason: z.string().optional() })
    .optional(),
  env: z.array(ManifestEnvSchema).optional(),
});

export const BuildManifestSchema = z.object({
  manifestVersion: z.number().int().positive(),
  adapter: z.object({ package: z.string(), version: z.string().optional() }),
  framework: z.object({ name: z.string(), version: z.string().optional() }),
  /** `ssr` needs an Edge Script. `static` is files only, and deploys like any other static site. */
  kind: z.enum(["ssr", "static"]),
  /** The one file to deploy. Required for `ssr`. */
  script: z
    .object({
      /** Path to the built file, relative to the project root. */
      entry: z.string(),
      type: z.enum(["standalone", "middleware"]),
      bytes: z.number().int().nonnegative().optional(),
    })
    .optional(),
  assets: z.object({
    /** The folder to upload, relative to the project root. */
    dir: z.string(),
  }),
  requires: ManifestRequiresSchema.optional(),
  dev: z
    .object({ command: z.string().optional(), preview: z.string().optional() })
    .optional(),
});

export type BuildManifest = z.infer<typeof BuildManifestSchema>;
export type ManifestEnv = z.infer<typeof ManifestEnvSchema>;
export type ManifestPullZone = z.infer<typeof ManifestPullZoneSchema>;
