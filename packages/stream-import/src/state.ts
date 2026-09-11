/**
 * Import state: the schema a saved run must satisfy before it is resumed, and a
 * file-backed `StateStore`. The host decides the path; one file per source and
 * library keeps two imports from clobbering each other.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { MigrationState, StateStore } from "./contracts.ts";

const videoMigrationStatus = z.enum([
  "pending",
  "fetching",
  "processing",
  "completed",
  "failed",
]);

const migrationStatus = z.enum([
  "in_progress",
  "completed",
  "failed",
  "paused",
]);

const folderMapping = z.object({
  sourceFolderId: z.string(),
  sourceFolderName: z.string(),
  bunnyCollectionId: z.string(),
  bunnyCollectionName: z.string(),
});

const videoMigration = z.object({
  sourceVideoId: z.string(),
  videoName: z.string(),
  sourceFolderId: z.string().nullable(),
  bunnyVideoId: z.string().nullable(),
  bunnyCollectionId: z.string().nullable(),
  status: videoMigrationStatus,
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  encodeProgress: z.number().min(0).max(100),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// `source` is a plain string, not a closed enum, so a state file written with an extra source module still parses.
export const migrationStateSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  source: z.string(),
  bunnyLibraryId: z.string(),
  bunnyAccountId: z.string().optional(),
  sourceFolderId: z.string().nullable().optional(),
  folderMappings: z.array(folderMapping),
  videoMigrations: z.array(videoMigration),
  status: migrationStatus,
});

export function validateMigrationState(data: unknown): MigrationState | null {
  const result = migrationStateSchema.safeParse(data);

  return result.success ? (result.data as MigrationState) : null;
}

export function getMigrationStateErrors(data: unknown): string[] {
  const result = migrationStateSchema.safeParse(data);

  return result.success
    ? []
    : result.error.issues.map(
        (e) => `${e.path.join(".") || "(root)"}: ${e.message}`,
      );
}

/** Read and validate a saved state file; null when missing or unusable. */
export function readMigrationState(path: string): MigrationState | null {
  if (!existsSync(path)) return null;
  try {
    return validateMigrationState(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export interface FileStateStoreOptions {
  /** Told about a corrupted file the store is ignoring. */
  onWarn?: (message: string) => void;
}

/** A `StateStore` over one JSON file, created with owner-only permissions. */
export function createFileStateStore(
  path: string,
  options: FileStateStoreOptions = {},
): StateStore {
  return {
    load() {
      if (!existsSync(path)) return null;
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        const valid = validateMigrationState(parsed);
        if (!valid) {
          options.onWarn?.(
            `Ignoring corrupted import state: ${getMigrationStateErrors(parsed).slice(0, 3).join(", ")}`,
          );
        }

        return valid;
      } catch {
        return null;
      }
    },

    save(state) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
      try {
        chmodSync(path, 0o600);
      } catch {}
    },

    clear() {
      if (existsSync(path)) unlinkSync(path);
    },
  };
}
