import prompts from "prompts";
import { createMcClient } from "../../api/mc-client.ts";
import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { saveBunnyToml, bunnyTomlExists } from "./toml.ts";
import type { BunnyToml } from "./toml.ts";

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
        describe: "Runtime type",
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

    let name = rawName;
    if (!name) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "App name:",
      });
      name = value;
    }
    if (!name) throw new UserError("App name is required.");

    let runtime = rawRuntime as "shared" | "reserved" | undefined;
    if (!runtime) {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "Runtime type:",
        choices: [
          { title: "Shared", value: "shared" },
          { title: "Reserved", value: "reserved" },
        ],
      });
      runtime = value;
    }
    if (!runtime) throw new UserError("Runtime type is required.");

    let image = rawImage;
    if (!image) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Primary container image (e.g. nginx:latest):",
      });
      image = value;
    }
    if (!image) throw new UserError("Container image is required.");

    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(config.apiKey, undefined, verbose);

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
        container: { image },
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
