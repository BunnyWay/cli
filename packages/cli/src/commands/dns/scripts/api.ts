import type { createComputeClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";
import { UserError } from "../../../core/errors.ts";
import { SCRIPT_TYPE_DNS } from "./constants.ts";

export type ComputeClient = ReturnType<typeof createComputeClient>;
export type EdgeScript = components["schemas"]["EdgeScriptModel"];

/**
 * Fetch a single script by ID, throwing a UserError if it doesn't exist or is
 * not a Scriptable DNS script. Guards callers from treating a CDN or Middleware
 * Edge Script as a DNS script (linking it, deploying DNS code, or attaching it).
 */
export async function fetchDnsScript(
  client: ComputeClient,
  id: number,
): Promise<EdgeScript> {
  const { data } = await client.GET("/compute/script/{id}", {
    params: { path: { id } },
  });
  if (!data) throw new UserError(`DNS script ${id} not found.`);
  if (data.ScriptType !== SCRIPT_TYPE_DNS) {
    throw new UserError(
      `Script ${id} is not a Scriptable DNS script.`,
      "Pass the ID of a DNS script, or create one with `bunny dns scripts create`.",
    );
  }
  return data;
}

/** Fetch all DNS scripts on the account, paginated and sorted by name. */
export async function fetchDnsScripts(
  client: ComputeClient,
): Promise<EdgeScript[]> {
  const scripts: EdgeScript[] = [];
  let page = 1;
  for (;;) {
    const { data } = await client.GET("/compute/script", {
      params: { query: { type: [SCRIPT_TYPE_DNS], page, perPage: 1000 } },
    });
    scripts.push(...(data?.Items ?? []));
    if (!data?.HasMoreItems) break;
    page++;
  }

  return scripts.sort((a, b) => (a.Name ?? "").localeCompare(b.Name ?? ""));
}

/** Create a DNS script (no linked pull zone), returning its ID and name. */
export async function createDnsScript(
  client: ComputeClient,
  name: string,
): Promise<{ id: number; name: string }> {
  const { data } = await client.POST("/compute/script", {
    body: {
      Name: name,
      ScriptType: SCRIPT_TYPE_DNS,
      CreateLinkedPullZone: false,
    },
  });

  if (!data || data.Id == null) {
    throw new UserError("Failed to create DNS script.");
  }
  return { id: data.Id, name: data.Name ?? name };
}

/** Upload code to a DNS script, creating an unpublished deployment. */
export async function uploadCode(
  client: ComputeClient,
  id: number,
  code: string,
): Promise<void> {
  await client.POST("/compute/script/{id}/code", {
    params: { path: { id } },
    body: { Code: code },
  });
}

/** Publish the latest uploaded code as the live release. */
export async function publishScript(
  client: ComputeClient,
  id: number,
): Promise<void> {
  await client.POST("/compute/script/{id}/publish", {
    params: { path: { id, uuid: null } },
    body: {},
  });
}
