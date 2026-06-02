import type { createCoreClient } from "@bunny.net/openapi-client";
import { UserError } from "../../core/errors.ts";
import { loadManifest } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import {
  PULL_ZONE_MANIFEST,
  type PullZoneManifest,
} from "./constants.ts";

interface PullZone {
  Id: number;
  Name?: string | null;
}

export interface ResolvedPullZone {
  id: number;
  name?: string;
  source: "argument" | "manifest";
}

/**
 * Resolve a pull zone from a name-or-ID, or `.bunny/pullzone.json`.
 *
 * Tries name lookup first (case-insensitive). If no name matches and the
 * value is numeric, falls back to treating it as an ID. No manifest
 * fallback when a value is explicitly given.
 */
export async function resolvePullZoneId(
  client: ReturnType<typeof createCoreClient>,
  idOrName: string | undefined,
): Promise<ResolvedPullZone> {
  if (idOrName) {
    const isNumeric = /^\d+$/.test(idOrName);

    const spin = spinner(
      isNumeric
        ? `Fetching pull zone ${idOrName}...`
        : `Looking up pull zone "${idOrName}"...`,
    );
    spin.start();

    const { data } = await client.GET("/pullzone");
    const zones = (data ?? []) as PullZone[];

    spin.stop();

    // Try name match first
    const match = zones.find(
      (z) => z.Name?.toLowerCase() === idOrName.toLowerCase(),
    );

    if (match) {
      return { id: match.Id, name: match.Name ?? undefined, source: "argument" };
    }

    // Fall back to numeric ID — verify it exists in the list
    if (isNumeric) {
      const numericId = Number(idOrName);
      const byId = zones.find((z) => z.Id === numericId);
      if (byId) {
        return { id: byId.Id, name: byId.Name ?? undefined, source: "argument" };
      }
      throw new UserError(
        `Pull zone with ID ${numericId} not found.`,
        "Run `bunny pullzones list` to see available zones.",
      );
    }

    throw new UserError(
      `Pull zone "${idOrName}" not found.`,
      "Run `bunny pullzones list` to see available zones.",
    );
  }

  const manifest = loadManifest<PullZoneManifest>(PULL_ZONE_MANIFEST);
  if (manifest.id) {
    return { id: manifest.id, name: manifest.name, source: "manifest" };
  }

  throw new UserError(
    "No pull zone selected.",
    'Run "bunny pullzones select" or pass a zone name or ID.',
  );
}
