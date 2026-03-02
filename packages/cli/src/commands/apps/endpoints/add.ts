import prompts from "prompts";
import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId, resolveContainerId } from "../toml.ts";
import { clientOptions } from "../../../core/client-options.ts";

const COMMAND = "add";
const DESCRIPTION = "Add an endpoint to a container.";

interface AddArgs {
  id?: string;
  container?: string;
  type?: string;
  ssl?: boolean;
  "container-port"?: number;
  "public-port"?: number;
}

export const appsEndpointsAddCommand = defineCommand<AddArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.toml)",
      })
      .option("container", {
        type: "string",
        describe: "Container name (defaults to primary)",
      })
      .option("type", {
        type: "string",
        choices: ["cdn", "anycast"],
        describe: "Endpoint type",
      })
      .option("ssl", {
        type: "boolean",
        describe: "Enable SSL",
      })
      .option("container-port", {
        type: "number",
        describe: "Container port",
      })
      .option("public-port", {
        type: "number",
        describe: "Public port",
      }),

  handler: async ({
    id: rawId,
    container: containerName,
    type: rawType,
    ssl,
    "container-port": containerPort,
    "public-port": publicPort,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    if (!app) {
      throw new UserError(`App ${appId} not found.`);
    }

    const containerId = resolveContainerId(app, containerName);

    let endpointType = rawType as "cdn" | "anycast" | undefined;
    if (!endpointType) {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "Endpoint type:",
        choices: [
          { title: "CDN", value: "cdn" },
          { title: "Anycast", value: "anycast" },
        ],
      });
      endpointType = value;
    }
    if (!endpointType) throw new UserError("Endpoint type is required.");

    let cPort = containerPort;
    if (cPort === undefined) {
      const { value } = await prompts({
        type: "number",
        name: "value",
        message: "Container port:",
        initial: 3000,
      });
      cPort = value;
    }
    if (cPort === undefined) throw new UserError("Container port is required.");

    let pPort = publicPort;
    if (pPort === undefined) {
      const { value } = await prompts({
        type: "number",
        name: "value",
        message: "Public port:",
        initial: 443,
      });
      pPort = value;
    }
    if (pPort === undefined) throw new UserError("Public port is required.");

    const sslEnabled = ssl ?? true;

    const spin = spinner("Adding endpoint...");
    spin.start();

    const body: Record<string, unknown> = {
      displayName: endpointType,
    };

    if (endpointType === "cdn") {
      body.cdn = {
        isSslEnabled: sslEnabled,
        portMappings: [{ containerPort: cPort, exposedPort: pPort }],
      };
    } else {
      body.anycast = {
        type: "IPv4",
        portMappings: [{ containerPort: cPort, exposedPort: pPort }],
      };
    }

    await client.POST(
      "/apps/{appId}/containers/{containerId}/endpoints",
      {
        params: { path: { appId, containerId } },
        body: body as any,
      },
    );

    spin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify({ type: endpointType, containerPort: cPort, publicPort: pPort }),
      );
      return;
    }

    logger.success(`${endpointType.toUpperCase()} endpoint added.`);
  },
});
