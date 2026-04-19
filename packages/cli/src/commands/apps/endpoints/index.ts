import { defineNamespace } from "../../../core/define-namespace.ts";
import { appsEndpointsAddCommand } from "./add.ts";
import { appsEndpointsListCommand } from "./list.ts";
import { appsEndpointsRemoveCommand } from "./remove.ts";

export const appsEndpointsNamespace = defineNamespace(
  "endpoints",
  "Manage app endpoints.",
  [
    appsEndpointsAddCommand,
    appsEndpointsListCommand,
    appsEndpointsRemoveCommand,
  ],
);
