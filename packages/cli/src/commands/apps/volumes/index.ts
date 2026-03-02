import { defineNamespace } from "../../../core/define-namespace.ts";
import { appsVolumesListCommand } from "./list.ts";
import { appsVolumesRemoveCommand } from "./remove.ts";

export const appsVolumesNamespace = defineNamespace(
  "volumes",
  "Manage app volumes.",
  [appsVolumesListCommand, appsVolumesRemoveCommand],
);
