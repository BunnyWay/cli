import { defineNamespace } from "../../core/define-namespace.ts";
import { registryListCommand } from "./list.ts";
import { registryPushCommand } from "./push.ts";
import { registryTagsCommand } from "./tags.ts";

export const registryNamespace = defineNamespace("registry", false, [
  registryPushCommand,
  registryListCommand,
  registryTagsCommand,
]);
