import { defineNamespace } from "../../core/define-namespace.ts";
import { registryListCommand } from "./list.ts";
import { registryPushCommand } from "./push.ts";
import { registryTagsCommand } from "./tags.ts";

// Hidden namespace: the registry endpoint is configured out-of-band via
// BUNNYNET_REGISTRY_URL and not advertised in help output. Auth is handled
// per-request with the API token — there's no separate login step.
export const registryNamespace = defineNamespace("registry", false, [
  registryPushCommand,
  registryListCommand,
  registryTagsCommand,
]);
