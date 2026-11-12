import { ApiError, UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/magic-containers";
import { z } from "zod";
import type { McClient } from "@/tools/context.ts";
import { defineTool } from "@/tools/define-tool.ts";

type OverviewPod = components["schemas"]["OverviewPod"];
type OverviewContainer = components["schemas"]["OverviewContainer"];

export type PodContainer = Required<Pick<OverviewContainer, "id" | "name">> &
  Pick<OverviewContainer, "status">;

/** One running instance of an app, flattened out of its region. */
export interface Pod extends Pick<OverviewPod, "status"> {
  name: string;
  region: string;
  containers: PodContainer[];
}

/** Every pod of an app across its regions, with the containers each one runs. */
export async function fetchPods(
  client: McClient,
  appId: string,
  signal?: AbortSignal,
): Promise<Pod[]> {
  const { data } = await client.GET("/apps/{appId}/overview", {
    params: { path: { appId } },
    signal,
  });

  return (data?.regions ?? []).flatMap((region) =>
    (region.pods ?? []).flatMap((pod) =>
      pod.name
        ? [
            {
              name: pod.name,
              status: pod.status,
              region: region.region ?? "",
              containers: (pod.containers ?? []).flatMap((c) =>
                c.id
                  ? [{ id: c.id, name: c.name ?? c.id, status: c.status }]
                  : [],
              ),
            },
          ]
        : [],
    ),
  );
}

const PodSchema = z.object({
  name: z.string(),
  status: z
    .enum([
      "notScheduled",
      "scheduled",
      "ready",
      "deleting",
    ] satisfies components["schemas"]["PodStatus"][])
    .optional(),
  region: z.string(),
  containers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z
        .enum([
          "notStarted",
          "started",
          "ready",
        ] satisfies components["schemas"]["ContainerStatus"][])
        .optional(),
    }),
  ),
});

export const appsPodsList = defineTool({
  name: "apps.pods.list",
  title: "List app pods",
  description:
    "List the running instances (pods) of a Magic Containers app across its regions, with the containers each one runs.",
  schema: z.strictObject({
    app: z.string().min(1).describe("App ID."),
  }),
  kind: "read",
  resultSchema: z.array(PodSchema),
  examples: [[{ app: "abc123" }, "List the app's pods"]],
  run: (ctx, input) => fetchPods(ctx.clients.mc, input.app, ctx.signal),
});

/** Find a pod by name, or fail naming the ones that exist. */
export function findPod(pods: Pod[], appId: string, name: string): Pod {
  const pod = pods.find((p) => p.name === name);
  if (pod) return pod;
  throw new UserError(
    `Pod ${name} not found in app ${appId}.`,
    pods.length > 0
      ? `Running pods: ${pods.map((p) => p.name).join(", ")}.`
      : "The app has no running instances.",
  );
}

/** Find a container in a pod by name or ID, or fail naming the ones it runs. */
export function findContainer(pod: Pod, ref: string): PodContainer {
  const container =
    pod.containers.find((c) => c.name === ref) ??
    pod.containers.find((c) => c.id === ref);
  if (container) return container;
  throw new UserError(
    `Container ${ref} not found in pod ${pod.name}.`,
    pod.containers.length > 0
      ? `Containers: ${pod.containers.map((c) => c.name).join(", ")}.`
      : undefined,
  );
}

// What ApiError says for a 404 whose body explains nothing.
const NOT_FOUND_MESSAGE = "Not found.";

// `POST /apps/{appId}/exec` is not in the public Magic Containers spec yet, so it is typed here by hand.
interface ExecClient {
  POST(
    path: "/apps/{appId}/exec",
    init: {
      params: { path: { appId: string } };
      body: { podName: string; containerName: string };
      signal?: AbortSignal;
    },
  ): Promise<{ data?: { url?: string } }>;
}

const ExecSessionSchema = z.object({
  app: z.string(),
  pod: z.string(),
  container: z.object({ id: z.string(), name: z.string() }),
  url: z.string(),
});

export type ExecSession = z.infer<typeof ExecSessionSchema>;

export const appsExec = defineTool({
  name: "apps.exec",
  title: "Open an exec session",
  description:
    'Start an interactive exec session in a running container of a Magic Containers app. Returns a short-lived WebSocket URL that carries the terminal: binary frames are stdin and output, and a text frame `{"type":"resize","cols":N,"rows":N}` sets the terminal size.',
  schema: z.strictObject({
    app: z.string().min(1).describe("App ID."),
    pod: z.string().min(1).describe("Pod (instance) name."),
    container: z.string().min(1).describe("Container name or ID."),
  }),
  kind: "write",
  // The URL authorizes a shell in the container on its own.
  sensitive: true,
  resultSchema: ExecSessionSchema,
  examples: [
    [
      { app: "abc123", pod: "abc123-7f9c-x2k4q", container: "api" },
      "Open a shell in the api container",
    ],
  ],
  run: async (ctx, input): Promise<ExecSession> => {
    ctx.progress("Finding container...");
    const pods = await fetchPods(ctx.clients.mc, input.app, ctx.signal);
    const pod = findPod(pods, input.app, input.pod);
    const container = findContainer(pod, input.container);

    ctx.progress("Starting exec session...");
    const client = ctx.clients.mc as unknown as ExecClient;
    let url: string | undefined;
    try {
      // The API names the field containerName, but it takes the container's ID.
      const { data } = await client.POST("/apps/{appId}/exec", {
        params: { path: { appId: input.app } },
        body: { podName: pod.name, containerName: container.id },
        signal: ctx.signal,
      });
      url = data?.url;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw new UserError(
          "Exec isn't available for this account.",
          "Contact bunny.net support to enable container exec.",
        );
      }
      if (error instanceof ApiError && error.status === 404) {
        // The pod was just listed, so a bare 404 (no problem body, hence the generic message) means the route itself is missing.
        if (error.message === NOT_FOUND_MESSAGE) {
          throw new UserError(
            "This API has no exec endpoint.",
            "Container exec isn't available on this API yet. If the pod was replaced in the meantime, run the command again.",
          );
        }
        throw new UserError(
          `Couldn't open a session in ${container.name} on pod ${pod.name}: ${error.message}`,
          "The pod may have been replaced; run the command again to pick a current one.",
        );
      }
      throw error;
    }

    if (!url) throw new UserError("The API did not return an exec session.");
    return {
      app: input.app,
      pod: pod.name,
      container: { id: container.id, name: container.name },
      url,
    };
  },
});
