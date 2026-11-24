import { defineNamespace } from "@/core/define-namespace.ts";
import { appsRegionsListCommand } from "./list.ts";
import { appsRegionsSetCommand } from "./set.ts";
import { appsRegionsShowCommand } from "./show.ts";

export const appsRegionsNamespace = defineNamespace(
  "regions",
  "Manage app regions.",
  [appsRegionsListCommand, appsRegionsSetCommand, appsRegionsShowCommand],
);
