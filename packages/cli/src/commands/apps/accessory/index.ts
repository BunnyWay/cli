import { defineNamespace } from "../../../core/define-namespace.ts";
import { appsAccessoryListCommand } from "./list.ts";
import { appsAccessoryRestartCommand } from "./restart.ts";
import { appsAccessoryStartCommand } from "./start.ts";
import { appsAccessoryStopCommand } from "./stop.ts";

export const appsAccessoryNamespace = defineNamespace(
  "accessory",
  "Manage accessory containers.",
  [
    appsAccessoryListCommand,
    appsAccessoryRestartCommand,
    appsAccessoryStartCommand,
    appsAccessoryStopCommand,
  ],
);
