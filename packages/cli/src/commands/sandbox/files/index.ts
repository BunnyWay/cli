import { defineNamespace } from "../../../core/define-namespace.ts";
import { sandboxFilesListCommand } from "./list.ts";

export const sandboxFilesNamespace = defineNamespace(
  "files",
  "Manage files inside a sandbox: list.",
  [sandboxFilesListCommand],
  ["file"],
);
