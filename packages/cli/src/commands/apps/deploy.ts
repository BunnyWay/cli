import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import {
  ensureDockerAvailable,
  buildImage,
  pushImage,
  generateTag,
  promptRegistry,
} from "./docker.ts";
import { clientOptions } from "../../core/client-options.ts";
import {
  loadBunnyToml,
  saveBunnyToml,
  parseImageRef,
  tomlToAddRequest,
} from "./toml.ts";

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
    const toml = loadBunnyToml();
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    let appId = toml.app.id;
    let deployImage = image;

    // Build from Dockerfile if configured and no --image override
    const { dockerfile } = toml.app.container;
    let registry = toml.app.container.registry;

    if (dockerfile && !image) {
      await ensureDockerAvailable();

      // Prompt for registry if not set
      if (!registry) {
        const registryId = await promptRegistry(client);
        if (!registryId) {
          throw new UserError("A registry is required to build and push images.");
        }
        registry = registryId;
        toml.app.container.registry = registry;
        saveBunnyToml(toml);
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
          "Use `bunny apps registry list` to check your registries.",
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
        body: tomlToAddRequest(toml),
      });

      createSpin.stop();

      if (!result?.id) {
        throw new UserError("Failed to create app — no ID returned.");
      }

      appId = result.id;
      toml.app.id = appId;
      saveBunnyToml(toml);

      logger.success(`App "${toml.app.name}" created (${appId}).`);
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

      const { imageName, imageNamespace, imageTag } = parseImageRef(deployImage);

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
