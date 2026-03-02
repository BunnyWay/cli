import { existsSync } from "fs";
import { basename, join, resolve } from "path";
import prompts from "prompts";
import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { promptRegistry } from "./docker.ts";
import { saveBunnyToml, bunnyTomlExists } from "./toml.ts";
import type { BunnyToml, ContainerConfig } from "./toml.ts";
import { clientOptions } from "../../core/client-options.ts";

const COMMAND = "init";
const DESCRIPTION = "Initialize a new app config.";

interface InitArgs {
  name?: string;
  runtime?: string;
  image?: string;
}

export const appsInitCommand = defineCommand<InitArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .option("name", {
        type: "string",
        describe: "App name",
      })
      .option("runtime", {
        type: "string",
        choices: ["shared", "reserved"],
        default: "shared",
        describe: "Runtime type (default: shared)",
      })
      .option("image", {
        type: "string",
        describe: "Primary container image",
      }),

  handler: async ({
    name: rawName,
    runtime: rawRuntime,
    image: rawImage,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    if (bunnyTomlExists()) {
      throw new UserError(
        "A bunny.toml already exists in this directory.",
        "Use `bunny apps push` to sync changes or delete it first.",
      );
    }

    // Default app name to current directory name
    let name = rawName;
    if (!name) {
      const defaultName = basename(resolve(process.cwd()));
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "App name:",
        initial: defaultName,
      });
      name = value;
    }
    if (!name) throw new UserError("App name is required.");

    const runtime = (rawRuntime ?? "shared") as "shared" | "reserved";

    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    // Detect Dockerfile in cwd
    const dockerfilePath = join(process.cwd(), "Dockerfile");
    const hasDockerfile = existsSync(dockerfilePath);

    let container: ContainerConfig;

    if (hasDockerfile && !rawImage) {
      logger.info("Detected Dockerfile in current directory.");
      const { useDockerfile } = await prompts({
        type: "confirm",
        name: "useDockerfile",
        message: "Use this Dockerfile to build and deploy?",
        initial: true,
      });

      if (useDockerfile) {
        const registryId = await promptRegistry(client);
        if (!registryId) throw new UserError("A registry is required to build and push images.");
        container = { dockerfile: "Dockerfile", registry: registryId };
      } else {
        const { value } = await prompts({
          type: "text",
          name: "value",
          message: "Primary container image (e.g. nginx:latest):",
        });
        if (!value) throw new UserError("Container image is required.");
        container = { image: value };
      }
    } else if (rawImage) {
      container = { image: rawImage };
    } else {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Primary container image (e.g. nginx:latest):",
      });
      if (!value) throw new UserError("Container image is required.");
      container = { image: value };
    }

    // Fetch available regions for selection
    const spin = spinner("Fetching regions...");
    spin.start();

    const regionsResult = await client.GET("/regions");

    spin.stop();

    const availableRegions = regionsResult.data?.items ?? [];
    const regionsWithCapacity = availableRegions.filter((r) => r.hasCapacity);

    let selectedRegions: string[] = [];
    if (regionsWithCapacity.length > 0) {
      const { value } = await prompts({
        type: "multiselect",
        name: "value",
        message: "Select regions:",
        choices: regionsWithCapacity.map((r) => ({
          title: `${r.name} (${r.id})`,
          value: r.id!,
        })),
        min: 1,
      });
      selectedRegions = value ?? [];
    }

    if (selectedRegions.length === 0) {
      throw new UserError("At least one region must be selected.");
    }

    const toml: BunnyToml = {
      app: {
        name,
        runtime,
        scaling: { min: 1, max: 1 },
        regions: {
          allowed: selectedRegions,
          required: [selectedRegions[0]!],
        },
        container,
      },
    };

    saveBunnyToml(toml);

    if (output === "json") {
      logger.log(JSON.stringify(toml, null, 2));
      return;
    }

    logger.success("Config written to bunny.toml.");
    logger.dim("Run `bunny apps deploy` to create and deploy the app.");
  },
});
