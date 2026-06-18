import { createMcClient } from "@bunny.net/openapi-client";
import { getSandbox, resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";

interface AddArgs {
  name: string;
  port: number;
  label?: string;
}

export const sandboxUrlAddCommand = defineCommand<AddArgs>({
  command: "add <name> <port>",
  describe: "Expose a port as a public CDN endpoint.",
  examples: [
    ["$0 sandbox url add my-sandbox 3000", "Expose port 3000"],
    ["$0 sandbox url add my-sandbox 8080 --label api", "Expose port 8080 as 'api'"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", { type: "string", demandOption: true, describe: "Sandbox name" })
      .positional("port", { type: "number", demandOption: true, describe: "Container port to expose" })
      .option("label", { type: "string", describe: "Endpoint display name (defaults to 'port-<port>')" }),

  handler: async ({ name, port, label, profile, apiKey, verbose, output }) => {
    const record = getSandbox(name);
    if (!record) throw new UserError(`No sandbox named "${name}" found.`);

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createMcClient(clientOptions(config, verbose));

    const spin = spinner("Fetching sandbox info...");
    spin.start();

    // Get the container template ID from the app
    const { data: app, error: appError } = await client.GET("/apps/{appId}", {
      params: { path: { appId: record.app_id } },
    });
    if (appError || !app) {
      spin.stop();
      throw new UserError(`Failed to fetch app: ${JSON.stringify(appError)}`);
    }

    const containerId = (app as any).containerTemplates?.[0]?.id as string | undefined;
    if (!containerId) {
      spin.stop();
      throw new UserError("Could not find container template ID.");
    }

    const displayName = label ?? `port-${port}`;
    spin.text = `Creating endpoint "${displayName}"...`;

    const { data: ep, error: epError } = await (client as any).POST(
      "/apps/{appId}/containers/{containerId}/endpoints",
      {
        params: { path: { appId: record.app_id, containerId } },
        body: {
          displayName,
          cdn: {
            isSslEnabled: false,
            portMappings: [{ containerPort: port, protocols: ["Tcp"] }],
          },
        },
      },
    );

    if (epError) {
      spin.stop();
      throw new UserError(`Failed to create endpoint: ${JSON.stringify(epError)}`);
    }

    const endpointId = (ep as any)?.id as string;

    // Poll until publicHost is assigned
    spin.text = "Waiting for public URL...";
    const deadline = Date.now() + 60_000;
    let publicHost: string | null = null;
    while (Date.now() < deadline) {
      await Bun.sleep(2000);
      const { data: list } = await client.GET("/apps/{appId}/endpoints", {
        params: { path: { appId: record.app_id } },
      });
      const found = (list?.items ?? []).find((e: any) => e.id === endpointId);
      if (found?.publicHost) { publicHost = found.publicHost; break; }
    }

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ id: endpointId, displayName, port, publicHost }, null, 2));
      return;
    }

    logger.log(`Endpoint "${displayName}" created.`);
    logger.log(`  Port: ${port}`);
    logger.log(`  ID:   ${endpointId}`);
    logger.log(`  URL:  ${publicHost ? `https://${publicHost}` : "— (still provisioning)"}`);
  },
});
