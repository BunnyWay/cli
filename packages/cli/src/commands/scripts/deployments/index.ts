import { defineNamespace } from "@/core/define-namespace.ts";
import { scriptsDeploymentsListCommand } from "./list.ts";
import { scriptsDeploymentsPublishCommand } from "./publish.ts";

export const scriptsDeploymentsNamespace = defineNamespace(
  "deployments",
  "Manage Edge Script deployments.",
  [scriptsDeploymentsListCommand, scriptsDeploymentsPublishCommand],
);
