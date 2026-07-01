import { Sandbox, SandboxError } from "@bunny.net/sandbox";
import prompts from "prompts";
import { resolveConfig, setSandbox } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";

const DEFAULT_REGION = "AMS";

interface CreateArgs {
  name?: string;
  region: string;
}

export const sandboxCreateCommand = defineCommand<CreateArgs>({
  command: "create [name]",
  describe: "Create and start a new sandbox.",
  examples: [
    ["$0 sandbox create", "Interactive: prompts for a sandbox name"],
    ["$0 sandbox create my-sandbox", "Create a sandbox named my-sandbox"],
    [
      "$0 sandbox create my-sandbox --region NY",
      "Create a sandbox in New York",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Name for the sandbox",
      })
      .option("region", {
        type: "string",
        default: DEFAULT_REGION,
        describe: "Region ID to deploy the sandbox in (e.g. AMS, NY, LA)",
      }),

  handler: async ({ profile, verbose, apiKey, name, region, output }) => {
    const config = resolveConfig(profile, apiKey, verbose);

    // JSON output stays non-interactive; the name must come from the positional.
    const interactive = output !== "json";

    let sandboxName = name;
    if (!sandboxName && interactive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Sandbox name:",
      });
      sandboxName = value;
    }
    if (!sandboxName) throw new UserError("A sandbox name is required.");

    const spin = spinner("Creating sandbox...");
    spin.start();

    let sandbox: Sandbox;
    try {
      sandbox = await Sandbox.create({
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        verbose,
        onDebug: (msg) => logger.debug(msg, true),
        name: sandboxName,
        region,
      });
    } catch (err) {
      spin.stop();
      if (err instanceof SandboxError) throw new UserError(err.message);
      throw err;
    }

    spin.stop();

    const handle = sandbox.toHandle();
    sandbox.disconnect();
    setSandbox(sandboxName, {
      app_id: handle.appId,
      agent_token: handle.agentToken,
      ssh_host: handle.sshHost,
    });

    if (output === "json") {
      logger.log(
        JSON.stringify(
          { name: sandboxName, appId: handle.appId, sshHost: handle.sshHost },
          null,
          2,
        ),
      );
      return;
    }

    logger.log(`Sandbox "${sandboxName}" is ready.`);
    logger.log(`  App ID: ${handle.appId}`);
    logger.log(`  SSH:    ${handle.sshHost}`);
    logger.log(
      `\nRun commands with: bunny sandbox exec ${sandboxName} <command>`,
    );
  },
});
