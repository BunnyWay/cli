import { defineNamespace } from "../../core/define-namespace.ts";
import { sitesCreateCommand } from "./create.ts";
import { sitesDeleteCommand } from "./delete.ts";
import { sitesDeployCommand } from "./deploy.ts";
import { sitesDeploymentsNamespace } from "./deployments/index.ts";
import { sitesDomainsCommands } from "./domains/index.ts";
import { sitesEnvNamespace } from "./env/index.ts";
import { sitesLinkCommand } from "./link.ts";
import { sitesListCommand } from "./list.ts";
import { sitesShowCommand } from "./show.ts";
import { sitesUnlinkCommand } from "./unlink.ts";
import { sitesUpgradeCommand } from "./upgrade.ts";

export const sitesNamespace = defineNamespace("sites", false, [
  sitesCreateCommand,
  sitesListCommand,
  sitesShowCommand,
  sitesDeployCommand,
  sitesDeploymentsNamespace,
  ...sitesDomainsCommands,
  sitesEnvNamespace,
  sitesLinkCommand,
  sitesUnlinkCommand,
  sitesUpgradeCommand,
  sitesDeleteCommand,
]);
