import { Sandbox, SandboxError } from "@bunny.net/sandbox";
import { getSandbox, resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { spinner } from "@/core/ui.ts";

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
    [
      "$0 sandbox url add my-sandbox 8080 --label api",
      "Expose port 8080 as 'api'",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "Sandbox name",
      })
      .positional("port", {
        type: "number",
        demandOption: true,
        describe: "Container port to expose",
      })
      .option("label", {
        type: "string",
        describe: "Endpoint display name (defaults to 'port-<port>')",
      }),

  handler: async ({ name, port, label, profile, apiKey, verbose, output }) => {
    const record = getSandbox(name);
    if (!record) throw new UserError(`No sandbox named "${name}" found.`);

    const config = resolveConfig(profile, apiKey, verbose);

    const spin = spinner(`Exposing port ${port}...`);
    spin.start();

    let url: string;
    try {
      const sandbox = Sandbox.fromHandle(
        {
          appId: record.app_id,
          name,
          agentToken: record.agent_token,
          sshHost: record.ssh_host ?? "",
        },
        {
          apiKey: config.apiKey,
          apiUrl: config.apiUrl,
          verbose,
          onDebug: (msg) => logger.debug(msg, true),
        },
      );
      url = await sandbox.exposePort(port, label);
    } catch (err) {
      spin.stop();
      if (err instanceof SandboxError) throw new UserError(err.message);
      throw err;
    }

    spin.stop();

    const displayName = label ?? `port-${port}`;
    if (output === "json") {
      logger.log(JSON.stringify({ displayName, port, url }, null, 2));
      return;
    }

    logger.log(`Endpoint "${displayName}" created.`);
    logger.log(`  Port: ${port}`);
    logger.log(`  URL:  ${url}`);
  },
});
