import { defineNamespace } from "../../../core/define-namespace.ts";
import { scriptsEnvListCommand } from "./list.ts";
import { scriptsEnvPullCommand } from "./pull.ts";
import { scriptsEnvRemoveCommand } from "./remove.ts";
import { scriptsEnvSetCommand } from "./set.ts";

export const scriptsEnvNamespace = defineNamespace(
  "env",
  "Manage environment variables and secrets.",
  [
    scriptsEnvListCommand,
    scriptsEnvPullCommand,
    scriptsEnvRemoveCommand,
    scriptsEnvSetCommand,
  ],
);
