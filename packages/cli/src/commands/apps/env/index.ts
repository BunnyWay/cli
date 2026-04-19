import { defineNamespace } from "../../../core/define-namespace.ts";
import { appsEnvListCommand } from "./list.ts";
import { appsEnvPullCommand } from "./pull.ts";
import { appsEnvRemoveCommand } from "./remove.ts";
import { appsEnvSetCommand } from "./set.ts";

export const appsEnvNamespace = defineNamespace(
  "env",
  "Manage environment variables.",
  [
    appsEnvListCommand,
    appsEnvPullCommand,
    appsEnvRemoveCommand,
    appsEnvSetCommand,
  ],
);
