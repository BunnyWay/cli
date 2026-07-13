import { defineNamespace } from "../../../core/define-namespace.ts";
import { sitesCiInitCommand } from "./init.ts";

export const sitesCiNamespace = defineNamespace(
  "ci",
  "Set up CI deployments for a site.",
  [sitesCiInitCommand],
);
