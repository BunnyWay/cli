import { defineNamespace } from "@/core/define-namespace.ts";
import { telemetryDisableCommand } from "./disable.ts";
import { telemetryEnableCommand } from "./enable.ts";
import { telemetryStatusCommand } from "./status.ts";

export const telemetryNamespace = defineNamespace(
  "telemetry",
  "Manage anonymous usage data collection.",
  [telemetryStatusCommand, telemetryEnableCommand, telemetryDisableCommand],
);
