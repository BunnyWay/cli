import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import {
  dockerLogin,
  ensureDockerAvailable,
  pushImage,
  tagImage,
} from "../../core/docker.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { REGISTRY_USERNAME, resolveRegistryEndpoint } from "./client.ts";
import { buildTargetRef } from "./ref.ts";

const COMMAND = "push <image>";
const DESCRIPTION = "Push a local image to the bunny.net registry.";

interface PushArgs {
  image: string;
  repository?: string;
  tag?: string;
}

export const registryPushCommand = defineCommand<PushArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 registry push myapp:latest", "Push as myapp:latest"],
    [
      "$0 registry push myapp:dev --repository team/myapp --tag v1",
      "Push under an explicit repository and tag",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("image", {
        type: "string",
        describe: "Local image to push (e.g. myapp:latest)",
        demandOption: true,
      })
      .option("repository", {
        type: "string",
        describe: "Target repository (defaults to the source image name)",
      })
      .option("tag", {
        type: "string",
        describe: "Target tag (defaults to the source image tag)",
      }),

  handler: async ({
    image,
    repository,
    tag,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    if (!config.apiKey) {
      throw new UserError(
        "Not logged in.",
        'Run "bunny login" to authenticate.',
      );
    }

    const endpoint = resolveRegistryEndpoint();
    const target = buildTargetRef(endpoint.host, image, repository, tag);

    await ensureDockerAvailable();

    const loginSpin = spinner(`Logging in to ${endpoint.host}...`);
    loginSpin.start();
    try {
      await dockerLogin(endpoint.host, REGISTRY_USERNAME, config.apiKey);
    } finally {
      loginSpin.stop();
    }

    await tagImage(image, target.reference);
    await pushImage(target.reference);

    if (output === "json") {
      logger.log(
        JSON.stringify({
          reference: target.reference,
          repository: target.repository,
          tag: target.tag,
        }),
      );
      return;
    }

    logger.success(`Pushed ${target.reference}`);
  },
});
