import { defineNamespace } from "../../../core/define-namespace.ts";
import { dbRegionsAddCommand } from "./add.ts";
import { dbRegionsListCommand } from "./list.ts";
import { dbRegionsRemoveCommand } from "./remove.ts";
import { dbRegionsUpdateCommand } from "./update.ts";

export const dbRegionsNamespace = defineNamespace(
  "regions",
  "Manage database regions.",
  [
    dbRegionsAddCommand,
    dbRegionsListCommand,
    dbRegionsRemoveCommand,
    dbRegionsUpdateCommand,
  ],
);
