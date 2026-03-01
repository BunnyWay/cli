import { defineNamespace } from "../../../core/define-namespace.ts";
import { appsRegistryAddCommand } from "./add.ts";
import { appsRegistryListCommand } from "./list.ts";
import { appsRegistryRemoveCommand } from "./remove.ts";

export const appsRegistryNamespace = defineNamespace(
  "registry",
  "Manage container registries.",
  [appsRegistryAddCommand, appsRegistryListCommand, appsRegistryRemoveCommand],
);
