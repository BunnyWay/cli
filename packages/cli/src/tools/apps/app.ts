import type { components } from "@bunny.net/openapi-client/magic-containers";
import type { McClient } from "../context.ts";

type Application = components["schemas"]["Application"];

export async function fetchApp(
  client: McClient,
  appId: string,
): Promise<Application | undefined> {
  const { data } = await client.GET("/apps/{appId}", {
    params: { path: { appId } },
  });

  return data;
}
