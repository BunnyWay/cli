import { createMcClient } from "@bunny.net/openapi-client";
import { randomBytes } from "node:crypto";
import { resolveConfig, setSandbox } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { WORKPLACE } from "./ssh-exec.ts";

const IMAGE_REGISTRY_ID = "1156";
const IMAGE_NAMESPACE = "bunnyway";
const IMAGE_NAME = "sandbox-agent";
const IMAGE_TAG = "latest";
const DEFAULT_REGION = "AMS";
const POLL_INTERVAL_MS = 3000;
const STARTUP_TIMEOUT_MS = 120_000;

type App = Record<string, unknown> & {
  id?: string;
  status?: string;
  containerTemplates?: Array<{ endpoints?: Array<Record<string, unknown> & { type?: string; publicHost?: string }> }>;
};

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function extractAnycastHost(app: App): string | null {
  for (const ct of app.containerTemplates ?? []) {
    for (const ep of ct.endpoints ?? []) {
      if (ep.type === "anycast") {
        return (ep.publicHost as string | undefined) ?? null;
      }
    }
  }
  return null;
}

async function probeSsh(host: string, port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({ hostname: host, port, socket: { data() {}, open() {}, close() {}, error() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

async function waitUntilActive(
  client: ReturnType<typeof createMcClient>,
  appId: string,
): Promise<{ sshHost: string }> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  // Phase 1: poll API until the anycast SSH endpoint is assigned
  let sshHost: string | null = null;
  await Bun.sleep(3000);
  while (Date.now() < deadline) {
    const { data, error } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });
    if (error) throw new UserError(`Failed to poll app: ${JSON.stringify(error)}`);
    const app = data as App;
    const status = (app as Record<string, unknown>).status as string | undefined;
    if (status === "failing" || status === "suspended") {
      throw new UserError(`Sandbox entered terminal state: ${status}`);
    }
    sshHost = extractAnycastHost(app);
    if (sshHost) break;
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  if (!sshHost) {
    throw new UserError(`Sandbox SSH endpoint was not assigned within ${STARTUP_TIMEOUT_MS / 1000}s`);
  }

  // Phase 2: probe SSH port until the container accepts connections
  const [sshIp, sshPortStr] = (sshHost.includes(":") ? sshHost.split(":") : [sshHost, "8023"]) as [string, string];
  const sshPort = Number(sshPortStr);
  while (Date.now() < deadline) {
    if (await probeSsh(sshIp, sshPort)) return { sshHost };
    await Bun.sleep(POLL_INTERVAL_MS);
  }

  throw new UserError(`Sandbox SSH did not become reachable within ${STARTUP_TIMEOUT_MS / 1000}s`);
}

interface CreateArgs {
  name: string;
  region: string;
}

export const sandboxCreateCommand = defineCommand<CreateArgs>({
  command: "create [name]",
  describe: "Create and start a new sandbox.",
  examples: [
    ["$0 sandbox create", "Create a sandbox with a generated name"],
    ["$0 sandbox create my-sandbox", "Create a sandbox named my-sandbox"],
    ["$0 sandbox create my-sandbox --region NY", "Create a sandbox in New York"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        default: "sandbox",
        describe: "Name for the sandbox",
      })
      .option("region", {
        type: "string",
        default: DEFAULT_REGION,
        describe: "Region ID to deploy the sandbox in (e.g. AMS, NY, LA)",
      }),

  handler: async ({ profile, verbose, apiKey, name, region }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createMcClient(clientOptions(config, verbose));
    const agentToken = generateToken();

    const spin = spinner("Creating sandbox...");
    spin.start();

    const { data: app, error: createError } = await (client as any).POST("/apps", {
      body: {
        name,
        runtimeType: "shared",
        autoScaling: { min: 1, max: 1 },
        regionSettings: {
          allowedRegionIds: [region],
          requiredRegionIds: [region],
        },
        volumes: [
          { name: "workplace", size: 10 },
        ],
        containerTemplates: [
          {
            name: "agent",
            imageRegistryId: IMAGE_REGISTRY_ID,
            imageNamespace: IMAGE_NAMESPACE,
            imageName: IMAGE_NAME,
            imageTag: IMAGE_TAG,
            imagePullPolicy: "ifNotPresent",
            environmentVariables: [{ name: "AGENT_TOKEN", value: agentToken }],
            volumeMounts: [
              { name: "workplace", mountPath: WORKPLACE },
            ],
            endpoints: [
              {
                displayName: "ssh",
                anycast: {
                  type: "ipv4",
                  portMappings: [{ containerPort: 8023, exposedPort: 8023, protocols: ["Tcp"] }],
                },
              },
            ],
          },
        ],
      },
    });

    if (createError || !app) {
      spin.stop();
      throw new UserError(`Failed to create sandbox: ${JSON.stringify(createError)}`);
    }

    const appId = (app as Record<string, unknown>).id as string;
    spin.text = "Waiting for sandbox to become active...";

    let sshHost: string;
    try {
      ({ sshHost } = await waitUntilActive(client, appId));
    } catch (err) {
      spin.stop();
      // best-effort cleanup
      await client.DELETE("/apps/{appId}", { params: { path: { appId } } }).catch(() => {});
      throw err;
    }

    spin.stop();

    const record = { app_id: appId, agent_token: agentToken, ssh_host: sshHost };
    setSandbox(name, record);

    logger.log(`Sandbox "${name}" is ready.`);
    logger.log(`  App ID: ${appId}`);
    logger.log(`  SSH:    ${sshHost}`);
    logger.log(`\nRun commands with: bunny sandbox exec ${name} <command>`);
  },
});
