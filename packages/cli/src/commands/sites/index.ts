import { defineNamespace } from "../../core/define-namespace.ts";
import { sitesCiNamespace } from "./ci/index.ts";
import { sitesCreateCommand } from "./create.ts";
import { sitesDeleteCommand } from "./delete.ts";
import { sitesDeployCommand } from "./deploy.ts";
import { sitesDeploymentsNamespace } from "./deployments/index.ts";
import { sitesDomainsCommands } from "./domains/index.ts";
import { sitesLinkCommand } from "./link.ts";
import { sitesListCommand } from "./list.ts";
import { sitesOpenCommand } from "./open.ts";
import { sitesShowCommand } from "./show.ts";
import { sitesSslCommand } from "./ssl.ts";
import { sitesUnlinkCommand } from "./unlink.ts";

export const sitesNamespace = defineNamespace("sites", false, [
  sitesCreateCommand,
  sitesListCommand,
  sitesShowCommand,
  sitesOpenCommand,
  sitesDeployCommand,
  sitesDeploymentsNamespace,
  ...sitesDomainsCommands,
  sitesSslCommand,
  sitesCiNamespace,
  sitesLinkCommand,
  sitesUnlinkCommand,
  sitesDeleteCommand,
]);
