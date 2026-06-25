import { createComputeClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import { publishScript } from "./api.ts";
import { resolveDnsScriptId } from "./interactive.ts";

const COMMAND = "publish [id]";
const DESCRIPTION = "Publish the latest uploaded code as the live release.";

const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "DNS script ID (uses the linked script if omitted)";

interface PublishArgs {
  [ARG_ID]?: number;
}

/**
 * Publish a DNS script's latest uploaded code as the live release.
 *
 * Run this after `bunny dns scripts save` to make the saved code live.
 *
 * @example
 * ```bash
 * # Publish the linked script
 * bunny dns scripts publish
 *
 * # Publish a specific script
 * bunny dns scripts publish 12345
 * ```
 */
export const dnsScriptsPublishCommand = defineCommand<PublishArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 dns scripts publish", "Publish the linked script"],
    ["$0 dns scripts publish 12345", "Publish a specific script"],
  ],

  builder: (yargs) =>
    yargs.positional(ARG_ID, {
      type: "number",
      describe: ARG_ID_DESCRIPTION,
    }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const isInteractive = output !== "json" && process.stdout.isTTY;

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    const id = await resolveDnsScriptId(
      client,
      args[ARG_ID],
      "publish",
      isInteractive,
    );

    const spin = spinner("Publishing...");
    spin.start();
    try {
      await publishScript(client, id);
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(JSON.stringify({ id, published: true }, null, 2));
      return;
    }

    logger.success(`Published DNS script ${id}.`);
  },
});
