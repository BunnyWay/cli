import { defineNamespace } from "@/core/define-namespace.ts";
import { sandboxUrlAddCommand } from "./add.ts";
import { sandboxUrlListCommand } from "./list.ts";
import { sandboxUrlRemoveCommand } from "./remove.ts";

export const sandboxUrlNamespace = defineNamespace(
  "url",
  "Manage public URL endpoints for a sandbox.",
  [sandboxUrlAddCommand, sandboxUrlListCommand, sandboxUrlRemoveCommand],
);
