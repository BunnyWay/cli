import { createMcClient } from "@bunny.net/openapi-client";
import { getSandbox, resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";

export const sandboxUrlListCommand = defineCommand({
  command: "list <name>",
  aliases: ["ls"],
  describe: "List public endpoints for a sandbox.",
  examples: [["$0 sandbox url list my-sandbox", "List all endpoints"]],

  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      demandOption: true,
      describe: "Sandbox name",
    }),

  handler: async ({ name, profile, apiKey, verbose, output }: any) => {
    const record = getSandbox(name);
    if (!record) throw new UserError(`No sandbox named "${name}" found.`);

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching endpoints...");
    spin.start();

    const { data, error } = await client.GET("/apps/{appId}/endpoints", {
      params: { path: { appId: record.app_id } },
    });

    spin.stop();

    if (error)
      throw new UserError(
        `Failed to fetch endpoints: ${JSON.stringify(error)}`,
      );

    const DEFAULT_ENDPOINTS = new Set(["api", "ssh"]);
    const items = ((data?.items ?? []) as any[]).filter(
      (ep) => !DEFAULT_ENDPOINTS.has(ep.displayName),
    );

    if (output === "json") {
      logger.log(JSON.stringify(items, null, 2));
      return;
    }

    if (items.length === 0) {
      logger.info("No endpoints found.");
      return;
    }

    logger.log(
      formatTable(
        ["ID", "Name", "Type", "Port", "URL"],
        items.map((ep) => [
          ep.id ?? "",
          ep.displayName ?? "",
          ep.type ?? "",
          String(ep.portMappings?.[0]?.containerPort ?? ""),
          ep.publicHost ? `https://${ep.publicHost}` : "—",
        ]),
        output,
      ),
    );
  },
});
