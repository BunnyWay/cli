import { createMcClient } from "@bunny.net/openapi-client";
import { getSandbox, resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";

interface DeleteArgs {
  name: string;
  "endpoint-name": string;
  force: boolean;
}

export const sandboxUrlDeleteCommand = defineCommand<DeleteArgs>({
  command: "delete <name> <endpoint-name>",
  aliases: ["rm"],
  describe: "Delete a public endpoint from a sandbox.",
  examples: [
    ["$0 sandbox url delete my-sandbox port-3000", "Delete endpoint by name"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "Sandbox name",
      })
      .positional("endpoint-name", {
        type: "string",
        demandOption: true,
        describe: "Endpoint name (from url list)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip confirmation",
      }),

  handler: async ({
    name,
    "endpoint-name": endpointName,
    force,
    profile,
    apiKey,
    verbose,
  }) => {
    const record = getSandbox(name);
    if (!record) throw new UserError(`No sandbox named "${name}" found.`);

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Looking up endpoint...");
    spin.start();

    const { data, error: listError } = await client.GET(
      "/apps/{appId}/endpoints",
      {
        params: { path: { appId: record.app_id } },
      },
    );

    spin.stop();

    if (listError)
      throw new UserError(
        `Failed to fetch endpoints: ${JSON.stringify(listError)}`,
      );

    const ep = (data?.items ?? ([] as any[])).find(
      (e: any) => e.displayName === endpointName,
    );
    if (!ep)
      throw new UserError(
        `No endpoint named "${endpointName}" found. Run: bunny sandbox url list ${name}`,
      );

    if (!force) {
      const ok = await confirm(
        `Delete endpoint "${endpointName}" from sandbox "${name}"?`,
      );
      if (!ok) {
        logger.info("Aborted.");
        return;
      }
    }

    const spin2 = spinner("Deleting endpoint...");
    spin2.start();

    const { error } = await client.DELETE(
      "/apps/{appId}/endpoints/{endpointId}",
      {
        params: { path: { appId: record.app_id, endpointId: ep.id } },
      },
    );

    spin2.stop();

    if (error)
      throw new UserError(
        `Failed to delete endpoint: ${JSON.stringify(error)}`,
      );

    logger.log(`Endpoint "${endpointName}" deleted.`);
  },
});
