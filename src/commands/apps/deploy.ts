import { createMcClient } from "../../api/mc-client.ts";
import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
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
      describe: "Container image to deploy (e.g. ghcr.io/org/app:v1.2)",
    }),

  handler: async ({ image, profile, output, verbose, apiKey }) => {
    const toml = loadBunnyToml();
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(config.apiKey, undefined, verbose);

    let appId = toml.app.id;

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

    // If an image was provided, update the primary container first
    if (image) {
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

      const { imageName, imageNamespace, imageTag } = parseImageRef(image);

      const updateSpin = spinner("Updating container image...");
      updateSpin.start();

      await client.PATCH("/apps/{appId}/containers/{containerId}", {
        params: { path: { appId, containerId } },
        body: { image, imageName, imageNamespace, imageTag },
      });

      updateSpin.stop();
      logger.success(`Image updated to ${image}.`);
    }

    const deploySpin = spinner("Deploying...");
    deploySpin.start();

    await client.POST("/apps/{appId}/deploy", {
      params: { path: { appId } },
    });

    deploySpin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ id: appId, deployed: true, image }));
      return;
    }

    logger.success("App deployed.");
  },
});
