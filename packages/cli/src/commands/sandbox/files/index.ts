import { defineNamespace } from "@/core/define-namespace.ts";
import { sandboxFilesCpCommand } from "./cp.ts";
import { sandboxFilesListCommand } from "./list.ts";

export const sandboxFilesNamespace = defineNamespace(
  "files",
  "Manage files inside a sandbox: list, copy.",
  [sandboxFilesListCommand, sandboxFilesCpCommand],
  ["file"],
);
