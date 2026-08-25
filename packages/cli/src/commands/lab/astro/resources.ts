/**
 * The three resources one Astro app needs, and how to find them again.
 *
 * A storage zone holds the client build. A standalone Edge Script holds Astro's
 * server. A pull zone puts the script on a hostname, and the script is its
 * origin, so nothing sits between a request and the code.
 *
 * Every step looks its resource up by name first, so a half-finished create
 * re-runs cleanly rather than leaving a second set behind.
 */
import type { createComputeClient } from "@bunny.net/openapi-client";
import { ApiError, errorMessage, UserError } from "../../../core/errors.ts";
import {
  createPullZone,
  setForceSsl,
  systemHostname,
} from "../../../core/hostnames/index.ts";
import { logger } from "../../../core/logger.ts";
import { fetchScripts } from "../../scripts/api.ts";
import { SCRIPT_TYPE_STANDALONE } from "../../scripts/constants.ts";
import {
  type CoreClient,
  fetchStorageZone,
  type StorageZoneModel,
} from "../../storage/api.ts";
import { resourcePattern, scriptName, suffixedName } from "./naming.ts";
import { type LabState, STATE_VERSION } from "./state.ts";

export type ComputeClient = ReturnType<typeof createComputeClient>;

/** The default storage region. Frankfurt, which needs no endpoint prefix. */
export const DEFAULT_REGION = "DE";

// The globally-unique name is taken (often by another account, so a pre-create
// lookup missed it): a 409, or a 400 that says so.
function isNameTaken(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 409) return true;
  return (
    err.status === 400 &&
    /already (exists|taken|in use)|not available|is taken/i.test(err.message)
  );
}

export interface FoundResources {
  storageZone: StorageZoneModel;
  scriptId: number;
  pullZoneId: number;
  hostname?: string;
}

/** The `astro-{name}-{suffix}` storage zone, re-fetched by ID so it carries the passwords. */
export async function findStorageZone(
  client: CoreClient,
  appName: string,
): Promise<StorageZoneModel | undefined> {
  const { data } = await client.GET("/storagezone", {
    params: { query: { search: appName } },
  });
  const pattern = resourcePattern(appName);
  const match = (data ?? []).find(
    (zone) => pattern.test(zone.Name ?? "") && zone.Id != null,
  );
  return match?.Id == null
    ? undefined
    : fetchStorageZone(client, match.Id as number);
}

/** The pull zone whose origin is this script. */
async function findPullZone(
  client: CoreClient,
  appName: string,
  scriptId: number,
) {
  const { data } = await client.GET("/pullzone", {
    params: { query: { search: appName, perPage: 1000 } },
  });
  // The endpoint answers with a plain array for some queries and an envelope for
  // others, so read both shapes.
  const raw = data as unknown;
  const items = Array.isArray(raw)
    ? raw
    : ((raw as { Items?: unknown[] } | undefined)?.Items ?? []);
  return (
    items as {
      Id?: number;
      EdgeScriptId?: number;
      Hostnames?: Parameters<typeof systemHostname>[0];
    }[]
  ).find((pz) => pz.EdgeScriptId === scriptId);
}

/**
 * Find what this app already has, by name.
 *
 * This is what makes `--name` enough: a fresh clone, or a CI runner with no
 * `.bunny/astro.json`, finds the same three resources the last deploy made.
 * Returns null when the app has no storage zone, which means it has nothing.
 */
export async function findResources(opts: {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  appName: string;
}): Promise<FoundResources | null> {
  const storageZone = await findStorageZone(opts.coreClient, opts.appName);
  if (!storageZone?.Id) return null;

  const resourceName = storageZone.Name ?? opts.appName;
  const script = (await fetchScripts(opts.computeClient)).find(
    (s) => s.Name === scriptName(resourceName),
  );
  if (script?.Id == null) return null;

  const linked = script.LinkedPullZones?.[0]?.Id;
  const pullZone =
    linked == null
      ? await findPullZone(opts.coreClient, opts.appName, script.Id)
      : { Id: linked, Hostnames: undefined };
  if (pullZone?.Id == null) return null;

  return {
    storageZone,
    scriptId: script.Id,
    pullZoneId: pullZone.Id,
    hostname: await resolveHostname(
      opts.coreClient,
      pullZone.Id,
      pullZone.Hostnames,
    ),
  };
}

/** The zone's `*.b-cdn.net` host, fetching the zone when the caller has no list. */
async function resolveHostname(
  client: CoreClient,
  pullZoneId: number,
  hostnames: Parameters<typeof systemHostname>[0] | undefined,
): Promise<string | undefined> {
  if (hostnames) return systemHostname(hostnames) ?? undefined;
  const { data } = await client.GET("/pullzone/{id}", {
    params: { path: { id: pullZoneId } },
  });
  return systemHostname(data?.Hostnames ?? []) ?? undefined;
}

export interface CreateOptions {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  appName: string;
  region: string;
  onStep?: (message: string) => void;
}

/** Create what is missing, and return the state that describes all of it. */
export async function ensureResources(
  opts: CreateOptions,
): Promise<{ state: LabState; storageZone: StorageZoneModel }> {
  const { coreClient, computeClient, appName } = opts;
  const step = opts.onStep ?? (() => {});
  const region = (opts.region || DEFAULT_REGION).toUpperCase();

  // 1. The storage zone. Its name carries the suffix every other resource takes.
  step("Finding the storage zone...");
  let storageZone = await findStorageZone(coreClient, appName);
  if (!storageZone) {
    step("Creating the storage zone...");
    // Retry with fresh suffixes on the off chance a name is still taken.
    for (let attempt = 0; !storageZone && attempt < 3; attempt++) {
      const zoneName = suffixedName(appName);
      try {
        const { data } = await coreClient.POST("/storagezone", {
          body: { Name: zoneName, Region: region, ReplicationRegions: null },
        });
        if (!data?.Id) {
          throw new UserError(`Failed to create storage zone "${zoneName}".`);
        }
        // Re-fetch for the full record, which carries the zone passwords.
        storageZone = await fetchStorageZone(coreClient, data.Id);
      } catch (err) {
        if (!isNameTaken(err)) throw err;
      }
    }
  }
  if (!storageZone?.Id) {
    throw new UserError(
      `Couldn't find an available storage zone name for "${appName}".`,
      "Re-run the command, or choose another name with --name.",
    );
  }
  const resourceName = storageZone.Name ?? appName;

  // 2. The script, with the pull zone it is the origin of. A standalone script is
  // its own origin, so the compute API can create both: that is one call rather
  // than a public zone with no origin for a moment.
  step("Finding the Edge Script...");
  const wantedScript = scriptName(resourceName);
  let script = (await fetchScripts(computeClient)).find(
    (s) => s.Name === wantedScript,
  );
  if (script?.Id == null) {
    step("Creating the Edge Script...");
    const { data } = await computeClient.POST("/compute/script", {
      body: {
        Name: wantedScript,
        ScriptType: SCRIPT_TYPE_STANDALONE,
        CreateLinkedPullZone: true,
        LinkedPullZoneName: resourceName,
      },
    });
    if (data?.Id == null) {
      throw new UserError(`Failed to create Edge Script "${wantedScript}".`);
    }
    script = data;
  }
  const scriptId = script.Id as number;

  // 3. The pull zone. Normally the script created it; adopt an existing one on a
  // resumed create, and create one when the compute API made none.
  step("Finding the pull zone...");
  let pullZoneId = script.LinkedPullZones?.[0]?.Id ?? undefined;
  let hostnames: Parameters<typeof systemHostname>[0] | undefined;
  if (pullZoneId == null) {
    const found = await findPullZone(coreClient, appName, scriptId);
    if (found?.Id != null) {
      pullZoneId = found.Id;
      hostnames = found.Hostnames ?? undefined;
    }
  }
  if (pullZoneId == null) {
    step("Creating the pull zone...");
    const zone = await createPullZone(coreClient, resourceName, 0, {
      edgeScriptId: scriptId,
    });
    if (zone.Id == null) {
      throw new UserError(`Failed to create pull zone "${resourceName}".`);
    }
    pullZoneId = zone.Id;
    hostnames = zone.Hostnames ?? undefined;
  }

  const hostname = await resolveHostname(coreClient, pullZoneId, hostnames);

  // Force HTTPS on the `*.b-cdn.net` host. It is already on bunny's wildcard
  // certificate, so this only redirects HTTP. Best effort: a site that serves
  // over HTTP is still a site.
  if (hostname) {
    try {
      await setForceSsl(coreClient, pullZoneId, hostname, true);
    } catch (err) {
      logger.warn(`Couldn't force HTTPS on ${hostname}: ${errorMessage(err)}`);
    }
  }

  return {
    storageZone,
    state: {
      version: STATE_VERSION,
      name: appName,
      storageZone: resourceName,
      storageZoneId: storageZone.Id,
      region: (storageZone.Region ?? region).toLowerCase(),
      scriptId,
      pullZoneId,
      ...(hostname ? { hostname } : {}),
    },
  };
}

export interface TeardownResult {
  resource: "pull zone" | "edge script" | "storage zone";
  id: number;
  deleted: boolean;
  error?: string;
}

/**
 * Delete the three resources, in the order that leaves nothing serving.
 *
 * The pull zone goes first: it is the only public thing, and taking it down stops
 * requests before the code behind it disappears. A 404 from the API counts as
 * deleted, because the resource is gone either way, which is what lets a failed
 * run be repeated.
 */
export async function deleteResources(opts: {
  coreClient: CoreClient;
  computeClient: ComputeClient;
  state: LabState;
  keepStorage: boolean;
}): Promise<TeardownResult[]> {
  const results: TeardownResult[] = [];

  const attempt = async (
    resource: TeardownResult["resource"],
    id: number,
    call: () => Promise<unknown>,
  ) => {
    try {
      await call();
      results.push({ resource, id, deleted: true });
    } catch (err) {
      const gone = err instanceof ApiError && err.status === 404;
      results.push({
        resource,
        id,
        deleted: gone,
        ...(gone ? {} : { error: errorMessage(err) }),
      });
    }
  };

  await attempt("pull zone", opts.state.pullZoneId, () =>
    opts.coreClient.DELETE("/pullzone/{id}", {
      params: { path: { id: opts.state.pullZoneId } },
    }),
  );
  await attempt("edge script", opts.state.scriptId, () =>
    opts.computeClient.DELETE("/compute/script/{id}", {
      params: { path: { id: opts.state.scriptId } },
    }),
  );
  if (!opts.keepStorage) {
    await attempt("storage zone", opts.state.storageZoneId, () =>
      opts.coreClient.DELETE("/storagezone/{id}", {
        params: { path: { id: opts.state.storageZoneId } },
      }),
    );
  }
  return results;
}
