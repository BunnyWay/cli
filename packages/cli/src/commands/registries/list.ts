import { createMcClient } from "@bunny.net/api";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";

const COMMAND = "list";
const DESCRIPTION = "List container registries.";

export const registryListCommand = defineCommand({
  command: COMMAND,
  describe: DESCRIPTION,
  aliases: ["ls"],

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching registries...");
    spin.start();

    const { data } = await client.GET("/registries");

    spin.stop();

    const registries = data?.items ?? [];

    if (output === "json") {
      logger.log(JSON.stringify(registries, null, 2));
      return;
    }

    if (registries.length === 0) {
      logger.info("No registries configured.");
      return;
    }

    const rows = registries.map((r) => [
      String(r.id ?? ""),
      r.displayName ?? "",
      r.hostName ?? "",
      r.userName ?? "",
    ]);

    logger.log(
      formatTable(["ID", "Name", "Hostname", "Username"], rows, output),
    );
  },
});
