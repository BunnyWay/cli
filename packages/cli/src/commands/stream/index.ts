import { defineNamespace } from "@/core/define-namespace.ts";
import { streamImportNamespace } from "./import/index.ts";

export const streamNamespace = defineNamespace("stream", false, [
  streamImportNamespace,
]);
