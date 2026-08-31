import type { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";

type CoreClient = ReturnType<typeof createCoreClient>;

export type EdgeRule = components["schemas"]["EdgeRuleV2Model"];
export type EdgeRuleTrigger = components["schemas"]["Trigger"];

// The generated schema types these as bare numbers; named constants keep call sites readable.
export const EdgeRuleAction = {
  Redirect: 1,
  OriginUrl: 2,
  OverrideCacheTime: 3,
  BlockRequest: 4,
  SetResponseHeader: 5,
  SetRequestHeader: 6,
  OverrideBrowserCacheTime: 16,
} as const;

export const EdgeRuleTriggerType = {
  Url: 0,
  RequestHeader: 1,
  ResponseHeader: 2,
  UrlExtension: 3,
} as const;

export const EdgeRuleMatch = {
  Any: 0,
  All: 1,
  None: 2,
} as const;

/** The pull zone's edge rules; the zone GET is the only endpoint that returns them. */
export async function fetchEdgeRules(
  client: CoreClient,
  pullZoneId: number,
): Promise<EdgeRule[]> {
  const { data } = await client.GET("/pullzone/{id}", {
    params: { path: { id: pullZoneId } },
  });
  return data?.EdgeRules ?? [];
}

// Upsert keyed on Description: addOrUpdate creates a duplicate unless the existing rule's Guid is passed, so the description doubles as the rule's identity.
export async function upsertEdgeRule(
  client: CoreClient,
  pullZoneId: number,
  rule: EdgeRule & { Description: string },
  existingRules?: EdgeRule[],
): Promise<void> {
  const rules = existingRules ?? (await fetchEdgeRules(client, pullZoneId));
  const existing = rules.find((r) => r.Description === rule.Description);
  await client.POST("/pullzone/{pullZoneId}/edgerules/addOrUpdate", {
    params: { path: { pullZoneId } },
    body: { ...rule, ...(existing?.Guid ? { Guid: existing.Guid } : {}) },
  });
}

export async function deleteEdgeRule(
  client: CoreClient,
  pullZoneId: number,
  guid: string,
): Promise<void> {
  await client.DELETE("/pullzone/{pullZoneId}/edgerules/{edgeRuleId}", {
    params: { path: { pullZoneId, edgeRuleId: guid } },
  });
}
