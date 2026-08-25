/**
 * Getting one build in front of visitors.
 *
 * Two steps at the API, and then the cache in front of them. The cache is the
 * part that has caught people out: without the purges below, the command reports
 * success while the site still serves the release before it.
 */
import type { ManifestPullZone } from "@bunny.net/config";
import { errorMessage } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import type { CoreClient } from "../../storage/api.ts";
import type { ComputeClient } from "./resources.ts";

/**
 * The line put at the top of the bundle, so the code carries the name of the
 * folder its files are in.
 *
 * `var` and not `globalThis.x =` alone: a bundle is an ES module, and this has
 * to be visible to code that reads `globalThis`. Assigning to `globalThis` does
 * both, in every runtime the script may start in.
 */
export function deployPreamble(info: {
  id: string;
  assetPrefix: string;
  site: string;
  environment: string;
}): string {
  return `globalThis.__BUNNY_DEPLOY__ = ${JSON.stringify(info)};\n`;
}

/**
 * How long to let a new release reach the edge nodes before the second purge.
 *
 * A probe cannot tell the outgoing release from the incoming one: both answer
 * 200 with a page. So this waits rather than polls, and the second purge is what
 * clears anything the first one re-cached from the old release.
 */
const SETTLE_MS = 5000;

/** Overridden by the test, which has no five seconds to spare. */
export const settle = {
  wait: (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface PublishOptions {
  computeClient: ComputeClient;
  coreClient: CoreClient;
  scriptId: number;
  pullZoneId: number;
  /** The bundle as the build wrote it. The preamble is added here, never on disk. */
  code: string;
  deploy: { id: string; assetPrefix: string; site: string };
}

/** Publish one deploy's code, and clear the cache in front of it. */
export async function publishDeploy(
  opts: PublishOptions,
): Promise<{ release?: string }> {
  const { computeClient, coreClient, scriptId } = opts;

  await computeClient.POST("/compute/script/{id}/code", {
    params: { path: { id: scriptId } },
    body: {
      Code:
        deployPreamble({ ...opts.deploy, environment: "production" }) +
        opts.code,
    },
  });
  await computeClient.POST("/compute/script/{id}/publish", {
    params: { path: { id: scriptId, uuid: null } },
    body: {},
  });

  const purge = () =>
    coreClient
      .POST("/pullzone/{id}/purgeCache", {
        params: { path: { id: opts.pullZoneId } },
        body: {},
      })
      .catch((err) => {
        logger.warn(
          `Couldn't purge the cache; the site may serve the previous release for a while: ${errorMessage(err)}`,
        );
      });

  await purge();
  await settle.wait(SETTLE_MS);
  await purge();

  return { release: await activeRelease(computeClient, scriptId) };
}

/** The live release's ID. Best effort: it is a label, not a lever. */
async function activeRelease(
  client: ComputeClient,
  scriptId: number,
): Promise<string | undefined> {
  try {
    const { data } = await client.GET("/compute/script/{id}/releases/active", {
      params: { path: { id: scriptId } },
    });
    return (data as { Uuid?: string } | null)?.Uuid ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The pull zone settings this deploy needs.
 *
 * Two come from the manifest, because only the adapter knows whether the script
 * sets cookies or caching headers. The third is ours: with the zone's
 * `CacheControlMaxAgeOverride` at its default the edge rewrites every
 * `Cache-Control` it forwards, so nothing the adapter returns reaches a visitor.
 * A page would sit a month stale in a browser that a purge cannot reach.
 *
 * Only what differs is written, and every change is reported. A developer who
 * changed one of these by hand should be able to see the CLI change it back.
 */
export async function applyPullZoneSettings(
  client: CoreClient,
  pullZoneId: number,
  want: ManifestPullZone | undefined,
): Promise<string[]> {
  const changed: string[] = [];

  const { data: zone } = await client.GET("/pullzone/{id}", {
    params: { path: { id: pullZoneId } },
  });
  if (!zone) return changed;

  const body: Record<string, boolean | number> = {};
  const wanted: Array<{
    field: string;
    value: boolean | number | undefined;
    label: string;
  }> = [
    {
      field: "DisableCookies",
      value: want?.disableCookies,
      label: want?.disableCookies === false ? "cookies on" : "cookies off",
    },
    {
      field: "EnableSmartCache",
      value: want?.enableSmartCache,
      label:
        want?.enableSmartCache === false ? "Smart Cache off" : "Smart Cache on",
    },
    {
      field: "EnableCacheSlice",
      value: want?.enableCacheSlice,
      label:
        want?.enableCacheSlice === false
          ? "large object delivery off"
          : "large object delivery on",
    },
    // The adapter owns Cache-Control, so the zone must stop overriding it.
    {
      field: "CacheControlMaxAgeOverride",
      value: -1,
      label: "cache override off",
    },
  ];

  for (const { field, value, label } of wanted) {
    if (value === undefined) continue;
    if ((zone as Record<string, unknown>)[field] === value) continue;
    body[field] = value;
    changed.push(label);
  }

  if (changed.length > 0) {
    await client.POST("/pullzone/{id}", {
      params: { path: { id: pullZoneId } },
      body,
    });
  }
  return changed;
}
