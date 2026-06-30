import {
  ApiError,
  type ClientOptions,
  createMcClient,
} from "@bunny.net/openapi-client";
import { SandboxError } from "./errors.ts";
import type { SandboxAuth, SandboxImage } from "./types.ts";

export const WORKPLACE = "/workplace";
export const SSH_PORT = 8023;

const POLL_INTERVAL_MS = 3000;
const PROVISION_TIMEOUT_MS = 120_000;
const PUBLIC_HOST_TIMEOUT_MS = 60_000;
const REGISTRY_RETRIES = 3;
const REGISTRY_RETRY_DELAY_MS = 4000;

type McClient = ReturnType<typeof createMcClient>;

interface AppContainer {
  id?: string;
  environmentVariables?: Array<{ name?: string; value?: string }>;
  endpoints?: Array<{ type?: string; publicHost?: string }>;
}

interface App {
  id?: string;
  status?: string;
  containerTemplates?: AppContainer[];
}

export function resolveApiKey(auth: SandboxAuth): string {
  const apiKey = auth.apiKey ?? process.env.BUNNYNET_API_KEY;
  if (!apiKey) {
    throw new SandboxError(
      "No API key. Pass { apiKey } or set BUNNYNET_API_KEY.",
    );
  }
  return apiKey;
}

export function mcClient(auth: SandboxAuth): McClient {
  const options: ClientOptions = {
    apiKey: resolveApiKey(auth),
    baseUrl: auth.apiUrl,
    verbose: auth.verbose,
    userAgent: "bunny-sandbox-sdk",
    onDebug: auth.onDebug,
  };
  return createMcClient(options);
}

export function extractAnycastHost(app: App): string | null {
  for (const ct of app.containerTemplates ?? []) {
    for (const ep of ct.endpoints ?? []) {
      if (ep.type === "anycast" && ep.publicHost) return ep.publicHost;
    }
  }
  return null;
}

export function extractAgentToken(app: App): string | null {
  for (const ct of app.containerTemplates ?? []) {
    for (const env of ct.environmentVariables ?? []) {
      if (env.name === "AGENT_TOKEN" && env.value) return env.value;
    }
  }
  return null;
}

export function firstContainerId(app: App): string | null {
  return app.containerTemplates?.[0]?.id ?? null;
}

/** Split a host:port string into a host and a port, defaulting to SSH_PORT. */
export function splitHost(host: string): { host: string; port: number } {
  if (!host.includes(":")) return { host, port: SSH_PORT };
  const [h, p] = host.split(":") as [string, string];
  return { host: h, port: Number(p) };
}

export async function getApp(client: McClient, appId: string): Promise<App> {
  const { data, error } = await client.GET("/apps/{appId}", {
    params: { path: { appId } },
  });
  if (error) throw new SandboxError(`Failed to fetch app: ${str(error)}`);
  return data as App;
}

export async function deleteApp(
  client: McClient,
  appId: string,
): Promise<void> {
  const { error } = await client.DELETE("/apps/{appId}", {
    params: { path: { appId } },
  });
  if (error) throw new SandboxError(`Failed to delete app: ${str(error)}`);
}

export async function createApp(
  client: McClient,
  params: {
    name: string;
    region: string;
    agentToken: string;
    volumeSize: number;
    env: Record<string, string>;
    image: SandboxImage;
  },
): Promise<string> {
  const environmentVariables = [
    { name: "AGENT_TOKEN", value: params.agentToken },
    ...Object.entries(params.env).map(([name, value]) => ({ name, value })),
  ];

  const body = {
    name: params.name,
    runtimeType: "shared",
    autoScaling: { min: 1, max: 1 },
    regionSettings: {
      allowedRegionIds: [params.region],
      requiredRegionIds: [params.region],
    },
    volumes: [{ name: "workplace", size: params.volumeSize }],
    containerTemplates: [
      {
        name: "agent",
        imageRegistryId: params.image.registryId,
        imageNamespace: params.image.namespace,
        imageName: params.image.name,
        imageTag: params.image.tag,
        // A pinned digest lets MC skip its flaky create-time registry lookup.
        ...(params.image.digest ? { imageDigest: params.image.digest } : {}),
        imagePullPolicy: "always",
        environmentVariables,
        volumeMounts: [{ name: "workplace", mountPath: WORKPLACE }],
        endpoints: [
          {
            displayName: "ssh",
            anycast: {
              type: "ipv4",
              portMappings: [
                {
                  containerPort: SSH_PORT,
                  exposedPort: SSH_PORT,
                  protocols: ["Tcp"],
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const data = await withRegistryRetry(async () => {
    const res = await (client as any).POST("/apps", { body });
    if (res.error || !res.data) {
      throw new SandboxError(`Failed to create sandbox: ${str(res.error)}`);
    }
    return res.data as App;
  });

  const appId = data.id;
  if (!appId) throw new SandboxError("Create returned no app ID.");
  return appId;
}

/** Retry the transient MC registry error, which asks the caller to try again. */
async function withRegistryRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= REGISTRY_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRegistryError(err) || attempt === REGISTRY_RETRIES) throw err;
      await sleep(REGISTRY_RETRY_DELAY_MS * attempt);
    }
  }
  // Unreachable: the final attempt always rethrows above.
  throw new SandboxError("Registry retry exhausted.");
}

/** Detect the catch-all MC registry error so it can be retried. */
function isRegistryError(err: unknown): boolean {
  const message =
    err instanceof ApiError || err instanceof SandboxError
      ? err.message
      : String(err);
  return message.toLowerCase().includes("container registry");
}

export async function waitForSshHost(
  client: McClient,
  appId: string,
  signal?: AbortSignal,
): Promise<string> {
  const deadline = Date.now() + PROVISION_TIMEOUT_MS;
  await sleep(POLL_INTERVAL_MS, signal);
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const app = await getApp(client, appId);
    if (app.status === "failing" || app.status === "suspended") {
      throw new SandboxError(`Sandbox entered terminal state: ${app.status}`);
    }
    const host = extractAnycastHost(app);
    if (host) return host;
    await sleep(POLL_INTERVAL_MS, signal);
  }
  throw new SandboxError(
    `SSH endpoint was not assigned within ${PROVISION_TIMEOUT_MS / 1000}s`,
  );
}

export async function addCdnEndpoint(
  client: McClient,
  appId: string,
  containerId: string,
  port: number,
  label?: string,
): Promise<string> {
  const displayName = label ?? `port-${port}`;
  // Reuse an endpoint of the same name so retries after a slow host assignment do not conflict.
  const existing = await findEndpointId(client, appId, displayName);
  if (existing) return existing;

  const { data, error } = await (client as any).POST(
    "/apps/{appId}/containers/{containerId}/endpoints",
    {
      params: { path: { appId, containerId } },
      body: {
        displayName,
        cdn: {
          isSslEnabled: false,
          portMappings: [{ containerPort: port, protocols: ["Tcp"] }],
        },
      },
    },
  );
  if (error) throw new SandboxError(`Failed to expose port: ${str(error)}`);
  const id = (data as { id?: string })?.id;
  if (!id) throw new SandboxError("Endpoint creation returned no ID.");
  return id;
}

/** Poll for the endpoint's public host. Returns null if it is not assigned within the window. */
export async function waitForPublicHost(
  client: McClient,
  appId: string,
  endpointId: string,
): Promise<string | null> {
  const deadline = Date.now() + PUBLIC_HOST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(2000);
    const app = await getApp(client, appId);
    if (app.status === "failing" || app.status === "suspended") {
      throw new SandboxError(`Sandbox entered terminal state: ${app.status}`);
    }
    const { data } = await client.GET("/apps/{appId}/endpoints", {
      params: { path: { appId } },
    });
    const items = (data?.items ?? []) as Array<{
      id?: string;
      publicHost?: string;
    }>;
    const found = items.find((e) => e.id === endpointId);
    if (found?.publicHost) return found.publicHost;
  }
  return null;
}

/** Find an existing CDN endpoint by display name, returning its ID or null. */
async function findEndpointId(
  client: McClient,
  appId: string,
  displayName: string,
): Promise<string | null> {
  const { data } = await client.GET("/apps/{appId}/endpoints", {
    params: { path: { appId } },
  });
  const items = (data?.items ?? []) as Array<{
    id?: string;
    type?: string;
    displayName?: string;
  }>;
  return (
    items.find((e) => e.type === "cdn" && e.displayName === displayName)?.id ??
    null
  );
}

function str(error: unknown): string {
  return typeof error === "string" ? error : JSON.stringify(error);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise((resolve) => setTimeout(resolve, ms));
}
