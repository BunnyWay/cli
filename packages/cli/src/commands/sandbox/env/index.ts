import { defineNamespace } from "@/core/define-namespace.ts";
import { sandboxEnvListCommand } from "./list.ts";
import { sandboxEnvRemoveCommand } from "./remove.ts";
import { sandboxEnvSetCommand } from "./set.ts";

export const sandboxEnvNamespace = defineNamespace(
  "env",
  "Manage persistent environment variables for a sandbox.",
  [sandboxEnvSetCommand, sandboxEnvListCommand, sandboxEnvRemoveCommand],
);
