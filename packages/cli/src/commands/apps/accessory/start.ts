import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId } from "../toml.ts";
import { loadBunnyToml, parseImageRef } from "../toml.ts";
import { clientOptions } from "../../../core/client-options.ts";

const COMMAND = "start <name>";
const DESCRIPTION = "Start an accessory container.";

interface StartArgs {
  name: string;
  id?: string;
}

export const appsAccessoryStartCommand = defineCommand<StartArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: 'Accessory name (from bunny.toml) or "all"',
        demandOption: true,
      })
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.toml)",
      }),

  handler: async ({ name, id: rawId, profile, output, verbose, apiKey }) => {
    const appId = resolveAppId(rawId);
    const toml = loadBunnyToml();
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const accessoryNames =
      name === "all"
        ? Object.keys(toml.accessories ?? {})
        : [name];

    if (accessoryNames.length === 0) {
      throw new UserError("No accessories defined in bunny.toml.");
    }

    // Fetch current app to check existing containers
    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    if (!app) {
      throw new UserError(`App ${appId} not found.`);
    }

    const existingNames = new Set(app.containerTemplates.map((c) => c.name));
    const started: string[] = [];
    const skipped: string[] = [];

    for (const accName of accessoryNames) {
      const accConfig = toml.accessories?.[accName];
      if (!accConfig) {
        throw new UserError(
          `Accessory "${accName}" not found in bunny.toml.`,
          `Available: ${Object.keys(toml.accessories ?? {}).join(", ")}`,
        );
      }

      if (existingNames.has(accName)) {
        skipped.push(accName);
        continue;
      }

      const { imageName, imageNamespace, imageTag } = parseImageRef(
        accConfig.image ?? "",
      );

      const spin = spinner(`Starting ${accName}...`);
      spin.start();

      await client.POST("/apps/{appId}/containers", {
        params: { path: { appId } },
        body: {
          name: accName,
          image: accConfig.image,
          imageName,
          imageNamespace,
          imageTag,
          imageRegistryId: accConfig.registry ?? "",
          environmentVariables: accConfig.env
            ? Object.entries(accConfig.env).map(([k, v]) => ({
                name: k,
                value: v,
              }))
            : undefined,
          volumeMounts: accConfig.volumes?.map((v) => ({
            name: v.name,
            mountPath: v.mount,
          })),
        },
      });

      spin.stop();
      started.push(accName);
    }

    // Deploy to activate changes
    if (started.length > 0) {
      const deploySpin = spinner("Deploying changes...");
      deploySpin.start();

      await client.POST("/apps/{appId}/deploy", {
        params: { path: { appId } },
      });

      deploySpin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify({ started, skipped }));
      return;
    }

    for (const s of started) {
      logger.success(`Started ${s}.`);
    }
    for (const s of skipped) {
      logger.info(`${s} is already running.`);
    }
  },
});
