import { defineNamespace } from "../../../core/define-namespace.ts";
import { sandboxEnvDeleteCommand } from "./delete.ts";
import { sandboxEnvListCommand } from "./list.ts";
import { sandboxEnvSetCommand } from "./set.ts";

export const sandboxEnvNamespace = defineNamespace(
  "env",
  "Manage persistent environment variables for a sandbox.",
  [sandboxEnvSetCommand, sandboxEnvListCommand, sandboxEnvDeleteCommand],
);
