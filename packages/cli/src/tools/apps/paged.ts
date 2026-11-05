import type { components } from "@bunny.net/openapi-client/magic-containers";
import type { McClient } from "../context.ts";

type AppListItem = components["schemas"]["AppListItem"];
type Region = components["schemas"]["Region"];

async function collectPages<T>(
  fetchPage: (
    cursor?: string,
  ) => Promise<{ items?: T[]; cursor?: string | null } | undefined>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;

  do {
    const page = await fetchPage(cursor);

    items.push(...(page?.items ?? []));

    const next = page?.cursor ?? undefined;
    if (next === cursor) break;

    cursor = next;
  } while (cursor);

  return items;
}

export function fetchAllApps(client: McClient): Promise<AppListItem[]> {
  return collectPages(async (nextCursor) => {
    const { data } = await client.GET("/apps", {
      params: { query: { limit: 1000, nextCursor } },
    });

    return data;
  });
}

export function fetchAllRegions(client: McClient): Promise<Region[]> {
  return collectPages(async (nextCursor) => {
    const { data } = await client.GET("/regions", {
      params: { query: { limit: 1000, nextCursor } },
    });

    return data;
  });
}
