import { defineNamespace } from "@/core/define-namespace.ts";
import { sandboxUrlAddCommand } from "./add.ts";
import { sandboxUrlDeleteCommand } from "./delete.ts";
import { sandboxUrlListCommand } from "./list.ts";

export const sandboxUrlNamespace = defineNamespace(
  "url",
  "Manage public URL endpoints for a sandbox.",
  [sandboxUrlAddCommand, sandboxUrlListCommand, sandboxUrlDeleteCommand],
);
