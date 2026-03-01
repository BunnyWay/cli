import { createMcClient } from "../../../api/mc-client.ts";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { resolveAppId } from "../toml.ts";

const COMMAND = "stop <name>";
const DESCRIPTION = "Stop an accessory container.";

interface StopArgs {
  name: string;
  id?: string;
  force?: boolean;
}

export const appsAccessoryStopCommand = defineCommand<StopArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: 'Accessory name or "all"',
        demandOption: true,
      })
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.toml)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Skip confirmation prompt",
      }),

  handler: async ({
    name,
    id: rawId,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(config.apiKey, undefined, verbose);

    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    if (!app) {
      throw new UserError(`App ${appId} not found.`);
    }

    const primaryId = app.containerTemplates[0]?.id;

    const accessories = app.containerTemplates.filter(
      (c) => c.id !== primaryId,
    );

    const toStop =
      name === "all"
        ? accessories
        : accessories.filter(
            (c) => c.name.toLowerCase() === name.toLowerCase(),
          );

    if (toStop.length === 0) {
      throw new UserError(
        name === "all"
          ? "No accessories to stop."
          : `Accessory "${name}" not found.`,
      );
    }

    if (!force) {
      const names = toStop.map((c) => c.name).join(", ");
      const confirmed = await confirm(
        `Stop ${names}? This removes the container template.`,
      );
      if (!confirmed) {
        logger.log("Stop cancelled.");
        return;
      }
    }

    const stopped: string[] = [];

    for (const container of toStop) {
      const spin = spinner(`Stopping ${container.name}...`);
      spin.start();

      await client.DELETE("/apps/{appId}/containers/{containerId}", {
        params: { path: { appId, containerId: container.id } },
      });

      spin.stop();
      stopped.push(container.name);
    }

    if (output === "json") {
      logger.log(JSON.stringify({ stopped }));
      return;
    }

    for (const s of stopped) {
      logger.success(`Stopped ${s}.`);
    }
  },
});
