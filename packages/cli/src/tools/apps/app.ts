import type { components } from "@bunny.net/openapi-client/magic-containers";
import type { McClient } from "../context.ts";

type Application = components["schemas"]["Application"];
type Volume = components["schemas"]["VolumeInList"];

export async function fetchApp(
  client: McClient,
  appId: string,
): Promise<Application | undefined> {
  const { data } = await client.GET("/apps/{appId}", {
    params: { path: { appId } },
  });

  return data;
}

export async function fetchVolumes(
  client: McClient,
  appId: string,
): Promise<Volume[]> {
  const { data } = await client.GET("/apps/{appId}/volumes", {
    params: { path: { appId } },
  });

  return data?.items ?? [];
}
