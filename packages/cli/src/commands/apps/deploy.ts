import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import {
  configToAddRequest,
  configToPatchRequest,
  loadConfig,
  parseImageRef,
  saveConfig,
} from "./config.ts";
import {
  buildImage,
  ensureDockerAvailable,
  generateTag,
  promptRegistry,
  pushImage,
} from "./docker.ts";

const COMMAND = "deploy";
const DESCRIPTION = "Deploy an app.";

interface DeployArgs {
  image?: string;
}

export const appsDeployCommand = defineCommand<DeployArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs.option("image", {
      type: "string",
      describe: "Container image to deploy (skips build if dockerfile is set)",
    }),

  handler: async ({ image, profile, output, verbose, apiKey }) => {
    const toml = loadConfig();
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    let appId = toml.app.id;
    let deployImage = image;

    // Get the primary (first) container from the containers map
    const containerEntries = Object.entries(toml.app.containers);
    const primaryContainer = containerEntries[0]?.[1];

    // Build from Dockerfile if configured and no --image override
    const dockerfile = primaryContainer?.dockerfile;
    let registry = primaryContainer?.registry;

    if (dockerfile && !image) {
      await ensureDockerAvailable();

      // Prompt for registry if not set
      if (!registry) {
        const registryId = await promptRegistry(client);
        if (!registryId) {
          throw new UserError(
            "A registry is required to build and push images.",
          );
        }
        registry = registryId;
        if (primaryContainer) {
          primaryContainer.registry = registry;
        }
        saveConfig(toml);
      }

      // Fetch registry details to get hostname
      const regSpin = spinner("Fetching registry...");
      regSpin.start();

      const { data: reg } = await client.GET("/registries/{registryId}", {
        params: { path: { registryId: Number(registry) } },
      });

      regSpin.stop();

      if (!reg?.hostName) {
        throw new UserError(
          `Registry ${registry} not found or has no hostname.`,
          "Use `bunny registry list` to check your registries.",
        );
      }

      const tag = await generateTag();
      const imageRef = `${reg.hostName}/${toml.app.name}:${tag}`;

      logger.info(`Building ${imageRef}...`);
      await buildImage(dockerfile, imageRef);

      logger.info(`Pushing ${imageRef}...`);
      await pushImage(imageRef);

      deployImage = imageRef;
    }

    // If no id, create the app on MC first
    if (!appId) {
      const createSpin = spinner("Creating app...");
      createSpin.start();

      const { data: result } = await client.POST("/apps", {
        body: configToAddRequest(toml),
      });

      createSpin.stop();

      if (!result?.id) {
        throw new UserError("Failed to create app — no ID returned.");
      }

      appId = result.id;
      toml.app.id = appId;
      saveConfig(toml);

      logger.success(`App "${toml.app.name}" created (${appId}).`);
    } else {
      // Existing app — push config changes before deploying
      const pushSpin = spinner("Pushing config...");
      pushSpin.start();

      const { data: existingApp } = await client.GET("/apps/{appId}", {
        params: { path: { appId } },
      });

      if (!existingApp) {
        pushSpin.stop();
        throw new UserError(`App ${appId} not found.`);
      }

      await client.PATCH("/apps/{appId}", {
        params: { path: { appId } },
        body: configToPatchRequest(toml, existingApp),
      });

      pushSpin.stop();
    }

    // If we have an image to deploy (from build or --image), update the primary container
    if (deployImage) {
      const fetchSpin = spinner("Fetching app...");
      fetchSpin.start();

      const { data: app } = await client.GET("/apps/{appId}", {
        params: { path: { appId } },
      });

      fetchSpin.stop();

      const containerId = app?.containerTemplates?.[0]?.id;
      if (!containerId) {
        throw new UserError("App has no containers.");
      }

      const { imageName, imageNamespace, imageTag } =
        parseImageRef(deployImage);

      const updateSpin = spinner("Updating container image...");
      updateSpin.start();

      await client.PATCH("/apps/{appId}/containers/{containerId}", {
        params: { path: { appId, containerId } },
        body: {
          image: deployImage,
          imageName,
          imageNamespace,
          imageTag,
          imageRegistryId: registry ?? "",
        },
      });

      updateSpin.stop();
      logger.success(`Image updated to ${deployImage}.`);
    }

    const deploySpin = spinner("Deploying...");
    deploySpin.start();

    await client.POST("/apps/{appId}/deploy", {
      params: { path: { appId } },
    });

    deploySpin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify({ id: appId, deployed: true, image: deployImage }),
      );
      return;
    }

    logger.success("App deployed.");
  },
});
