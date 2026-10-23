import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { DOCS_URL, telemetryStatus } from "@/core/telemetry.ts";

export const telemetryStatusCommand = defineCommand({
  command: "status",
  describe: "Show whether anonymous usage data is collected.",

  handler: async ({ output }) => {
    const status = telemetryStatus();

    if (output === "json") {
      logger.log(JSON.stringify(status, null, 2));
      return;
    }

    logger.log(`Telemetry is ${status.enabled ? "enabled" : "disabled"}.`);
    if (status.variable) logger.dim(`Disabled by ${status.variable}.`);
    logger.dim(`Learn more: ${DOCS_URL}`);
  },
});
