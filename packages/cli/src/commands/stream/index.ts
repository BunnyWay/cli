import { defineNamespace } from "@/core/define-namespace.ts";
import { streamImportCommand } from "./import.ts";

export const streamNamespace = defineNamespace("stream", false, [
  streamImportCommand,
]);
