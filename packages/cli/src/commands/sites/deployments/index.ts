import { defineNamespace } from "../../../core/define-namespace.ts";
import { sitesDeploymentsListCommand } from "./list.ts";
import { sitesDeploymentsPruneCommand } from "./prune.ts";
import { sitesDeploymentsPublishCommand } from "./publish.ts";

export const sitesDeploymentsNamespace = defineNamespace(
  "deployments",
  "Manage a site's deploys — list, publish (roll back), prune.",
  [
    sitesDeploymentsListCommand,
    sitesDeploymentsPublishCommand,
    sitesDeploymentsPruneCommand,
  ],
);
