import type { createComputeClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";
import { UserError } from "../../core/errors.ts";
import {
  type CoreClient,
  fetchHostnamesForZones,
  type Hostname,
  liveHostnames,
} from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { confirm, openBrowser } from "../../core/ui.ts";
import { SCRIPT_TYPE_MIDDLEWARE, SCRIPT_TYPE_STANDALONE } from "./constants.ts";

type ComputeClient = ReturnType<typeof createComputeClient>;
type EdgeScript = components["schemas"]["EdgeScriptModel"];
type EdgeScriptVariable = components["schemas"]["EdgeScriptVariableModel"];
type EdgeScriptSecret = components["schemas"]["EdgeScriptSecretModel"];

export interface EnvEntry {
  id: number;
  name: string;
  value: string;
  secret: boolean;
}

/** Fetch a single script by ID, throwing a UserError if it doesn't exist. */
export async function fetchScript(
  client: ComputeClient,
  id: number,
): Promise<EdgeScript> {
  const { data } = await client.GET("/compute/script/{id}", {
    params: { path: { id } },
  });
  if (!data) throw new UserError(`Edge Script ${id} not found.`);
  return data;
}

/** Fetch standalone + middleware scripts (excludes DNS), sorted by name. */
export async function fetchScripts(
  client: ComputeClient,
): Promise<EdgeScript[]> {
  const { data } = await client.GET("/compute/script", {
    params: {
      query: {
        includeLinkedPullzones: true,
        type: [SCRIPT_TYPE_STANDALONE, SCRIPT_TYPE_MIDDLEWARE],
      },
    },
  });

  return (data?.Items ?? []).sort((a, b) =>
    (a.Name ?? "").localeCompare(b.Name ?? ""),
  );
}

/** Fetch a script's variables and secrets, merged and sorted by name. */
export async function fetchEnvEntries(
  client: ComputeClient,
  id: number,
): Promise<EnvEntry[]> {
  const [scriptResult, secretsResult] = await Promise.all([
    client.GET("/compute/script/{id}", { params: { path: { id } } }),
    client.GET("/compute/script/{id}/secrets", { params: { path: { id } } }),
  ]);

  const variables = scriptResult.data?.EdgeScriptVariables ?? [];
  const secrets = secretsResult.data?.Secrets ?? [];

  return [
    ...variables.map((v: EdgeScriptVariable) => ({
      id: v.Id ?? 0,
      name: v.Name ?? "",
      value: v.DefaultValue ?? "",
      secret: false,
    })),
    ...secrets.map((s: EdgeScriptSecret) => ({
      id: s.Id ?? 0,
      name: s.Name ?? "",
      value: "",
      secret: true,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch every hostname across a script's linked pull zones (parallel; per-zone errors logged). */
export async function fetchScriptHostnames(
  coreClient: CoreClient,
  script: EdgeScript,
  verbose: boolean,
): Promise<Hostname[]> {
  const zoneIds = (script.LinkedPullZones ?? [])
    .map((zone) => zone.Id)
    .filter((id): id is number => id != null);
  return fetchHostnamesForZones(coreClient, zoneIds, (zoneId, err) =>
    logger.debug(
      `Failed to fetch hostnames for pull zone ${zoneId}: ${err}`,
      verbose,
    ),
  );
}

/** Print where a script is live, listing custom domains, falling back to the zone default. */
export function logLiveHostnames(
  script: EdgeScript,
  hostnames: Hostname[],
): void {
  const { primary, customs } = liveHostnames(hostnames);
  if (primary) {
    logger.info(`Live at: ${primary}`);
    for (const url of customs) logger.log(`  ${url}`);
    return;
  }
  const fallback = script.LinkedPullZones?.[0]?.DefaultHostname;
  if (fallback) logger.info(`Live at: ${fallback}`);
}

/** Prompt to open a script's hostname in the browser, with a deploy hint otherwise. */
export async function promptOpenInBrowser(hostname: string): Promise<void> {
  const shouldOpen = await confirm("Open script in browser?");
  if (shouldOpen) {
    const url = hostname.startsWith("http") ? hostname : `https://${hostname}`;
    logger.dim(`  Opening ${url}`);
    openBrowser(url);
  } else {
    logger.dim(
      "  Make changes locally, then run `bunny scripts deploy <file>` to publish.",
    );
  }
}
