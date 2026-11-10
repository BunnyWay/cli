import { defineNamespace } from "@/core/define-namespace.ts";
import { aiModelsCommand } from "./models.ts";
import { aiTextCommand } from "./text.ts";

export const aiNamespace = defineNamespace("ai", false, [
  aiTextCommand,
  aiModelsCommand,
]);
