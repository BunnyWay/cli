import type { components } from "@bunny.net/openapi-client/magic-containers";
import { z } from "zod";
import { defineTool } from "@/tools/define-tool.ts";
import type { McClient } from "../context.ts";
import { fetchAllApps } from "./paged.ts";

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

const AppSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z
    .enum([
      "unknown",
      "active",
      "progressing",
      "inactive",
      "failing",
      "suspended",
    ] satisfies components["schemas"]["ApplicationStatus"][])
    .optional(),
});

export type AppSummary = z.infer<typeof AppSummarySchema>;

export const appsList = defineTool({
  name: "apps.list",
  title: "List apps",
  description:
    "List the Magic Containers apps on the account, sorted by name, with their status.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(AppSummarySchema),
  run: async (ctx): Promise<AppSummary[]> => {
    ctx.progress("Fetching apps...");
    const apps = await fetchAllApps(ctx.clients.mc);
    return apps
      .flatMap((app) =>
        app.id
          ? [{ id: app.id, name: app.name ?? app.id, status: app.status }]
          : [],
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
