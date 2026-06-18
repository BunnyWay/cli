import { resolveConfig } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { registryRequest, resolveRegistryEndpoint } from "./client.ts";

const COMMAND = "list";
const DESCRIPTION = "List repositories in the bunny.net registry.";

interface Catalog {
  repositories?: string[];
}

export const registryListCommand = defineCommand({
  command: COMMAND,
  aliases: ["ls"],
  describe: DESCRIPTION,

  handler: async ({ profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    if (!config.apiKey) {
      throw new UserError(
        "Not logged in.",
        'Run "bunny login" to authenticate.',
      );
    }

    const endpoint = resolveRegistryEndpoint();

    const spin = spinner("Fetching repositories...");
    spin.start();
    let catalog: Catalog;
    try {
      catalog = await registryRequest<Catalog>(
        endpoint,
        config.apiKey,
        "/v2/_catalog",
      );
    } finally {
      spin.stop();
    }

    const repositories = catalog.repositories ?? [];

    if (output === "json") {
      logger.log(JSON.stringify({ repositories }, null, 2));
      return;
    }

    if (repositories.length === 0) {
      logger.info("No repositories found.");
      return;
    }

    logger.log(
      formatTable(
        ["Repository"],
        repositories.map((r) => [r]),
        output,
      ),
    );
  },
});
