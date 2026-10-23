import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import { setTelemetryEnabled, telemetryStatus } from "@/core/telemetry.ts";

export const telemetryDisableCommand = defineCommand({
  command: "disable",
  describe: "Stop anonymous usage data collection.",

  handler: async ({ output }) => {
    setTelemetryEnabled(false);

    if (output === "json") {
      logger.log(JSON.stringify(telemetryStatus(), null, 2));
      return;
    }

    logger.success("Telemetry disabled.");
  },
});
