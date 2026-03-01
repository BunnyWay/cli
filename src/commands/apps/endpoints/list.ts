import { createMcClient } from "../../../api/mc-client.ts";
import { resolveConfig } from "../../../config/index.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { resolveAppId } from "../toml.ts";

const COMMAND = "list";
const DESCRIPTION = "List endpoints.";

interface ListArgs {
  id?: string;
  container?: string;
}

export const appsEndpointsListCommand = defineCommand<ListArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  aliases: ["ls"],

  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "App ID (overrides bunny.toml)",
      })
      .option("container", {
        type: "string",
        describe: "Filter by container name",
      }),

  handler: async ({
    id: rawId,
    container: containerName,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const appId = resolveAppId(rawId);
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(config.apiKey, undefined, verbose);

    const spin = spinner("Fetching endpoints...");
    spin.start();

    const { data: app } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });

    spin.stop();

    if (!app) {
      logger.error(`App ${appId} not found.`);
      process.exit(1);
    }

    const allEndpoints: Array<{
      container: string;
      name: string;
      type: string;
      host: string;
      ssl: boolean;
      ports: string;
    }> = [];

    for (const ct of app.containerTemplates) {
      if (containerName && ct.name.toLowerCase() !== containerName.toLowerCase()) {
        continue;
      }
      for (const ep of ct.endpoints) {
        allEndpoints.push({
          container: ct.name,
          name: ep.displayName,
          type: ep.type,
          host: ep.publicHost,
          ssl: ep.isSslEnabled,
          ports: ep.portMappings
            .map((pm) => `${pm.exposedPort}→${pm.containerPort}`)
            .join(", "),
        });
      }
    }

    if (output === "json") {
      logger.log(JSON.stringify(allEndpoints, null, 2));
      return;
    }

    if (allEndpoints.length === 0) {
      logger.info("No endpoints configured.");
      return;
    }

    const rows = allEndpoints.map((ep) => [
      ep.container,
      ep.type,
      ep.host,
      ep.ssl ? "Yes" : "No",
      ep.ports,
    ]);

    logger.log(
      formatTable(["Container", "Type", "Host", "SSL", "Ports"], rows, output),
    );
  },
});
