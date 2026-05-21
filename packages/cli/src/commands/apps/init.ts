import { resolve } from "node:path";
import { createMcClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { configExists } from "./config.ts";
import { runWalkthrough } from "./walkthrough.ts";

const COMMAND = "init";
const DESCRIPTION = "Initialize a new app config (no deploy).";

interface InitArgs {
  name?: string;
  image?: string;
  dockerfile?: string | boolean;
  registry?: string;
  port?: number;
  command?: string;
  config?: string;
}

const DEFAULT_DOCKERFILE = "Dockerfile";

function normalizeDockerfileFlag(
  value: string | boolean | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === "") return DEFAULT_DOCKERFILE;
  if (value === false) return undefined;
  return value;
}

export const appsInitCommand = defineCommand<InitArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 apps init", "Walk through and scaffold bunny.jsonc"],
    [
      "$0 apps init ghcr.io/me/api:v1",
      "Scaffold bunny.jsonc pointed at a pre-built image",
    ],
    [
      "$0 apps init --dockerfile",
      "Scaffold bunny.jsonc for a Dockerfile-based build",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("image", {
        type: "string",
        describe:
          "Container image reference (e.g. ghcr.io/me/api:v1). Skips the build-vs-image prompt.",
      })
      .option("name", {
        type: "string",
        describe: "App name (skips the interactive prompt)",
      })
      .option("dockerfile", {
        type: "string",
        describe:
          "Build from Dockerfile. Pass a path or use bare flag for ./Dockerfile.",
      })
      .option("registry", {
        type: "string",
        describe: "bunny.net registry ID to push to",
      })
      .option("port", {
        type: "number",
        describe:
          "Override the container port (affects generated Dockerfile and endpoint)",
      })
      .option("command", {
        type: "string",
        describe:
          "Override the container CMD (passed as a single string, split on whitespace)",
      })
      .option("config", {
        type: "string",
        describe:
          "Write the config to this path instead of ./bunny.jsonc (useful in CI / agent flows)",
      }),

  handler: async ({
    name,
    image,
    dockerfile,
    registry,
    port,
    command,
    config: configArg,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const configPath = configArg
      ? resolve(process.cwd(), configArg)
      : undefined;

    if (configExists(configPath)) {
      const where = configPath ?? "this directory";
      throw new UserError(
        `A config file already exists at ${where}.`,
        "Use `bunny apps push` to sync changes or delete it first.",
      );
    }

    const cfg = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(cfg, verbose));

    const { config: toml } = await runWalkthrough(client, {
      positionalImage: image,
      dockerfileFlag: normalizeDockerfileFlag(dockerfile),
      registryFlag: registry,
      portOverride: port,
      commandOverride: command,
      nameOverride: name,
      configPath,
    });

    if (output === "json") {
      logger.log(JSON.stringify(toml, null, 2));
      return;
    }

    logger.dim("Run `bunny apps deploy` to create and deploy the app.");
  },
});
