import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { STATUS_LABELS } from "./constants.ts";

const COMMAND = "list";
const DESCRIPTION = "List all apps.";

export const appsListCommand = defineCommand({
  command: COMMAND,
  describe: DESCRIPTION,
  aliases: ["ls"],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching apps...");
    spin.start();

    const { data } = await client.GET("/apps");

    spin.stop();

    const apps = data?.items ?? [];

    if (output === "json") {
      logger.log(JSON.stringify(apps, null, 2));
      return;
    }

    if (apps.length === 0) {
      logger.info("No apps found.");
      return;
    }

    const rows = apps.map((app) => [
      app.id ?? "",
      app.name ?? "",
      STATUS_LABELS[(app.status as keyof typeof STATUS_LABELS) ?? "Unknown"] ??
        app.status ??
        "",
      app.displayEndpoint?.address ?? "",
    ]);

    logger.log(formatTable(["ID", "Name", "Status", "Endpoint"], rows, output));
  },
});
