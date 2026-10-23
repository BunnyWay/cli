import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { setTelemetryEnabled, telemetryStatus } from "@/core/telemetry.ts";

export const telemetryEnableCommand = defineCommand({
  command: "enable",
  describe: "Allow anonymous usage data collection.",

  handler: async ({ output }) => {
    setTelemetryEnabled(true);
    const status = telemetryStatus();

    if (output === "json") {
      logger.log(JSON.stringify(status, null, 2));
      return;
    }

    logger.success("Telemetry enabled.");
    if (status.variable) {
      logger.warn(`${status.variable} is set, so telemetry stays off.`);
    }
  },
});
