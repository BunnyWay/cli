import type { Argv } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { logger } from "@/core/logger.ts";
import { sitesCiNamespace } from "./ci/index.ts";
import { sitesCreateCommand } from "./create.ts";
import { sitesDeleteCommand } from "./delete.ts";
import { sitesDeployCommand } from "./deploy.ts";
import { sitesDeploymentsNamespace } from "./deployments/index.ts";
import { sitesDomainsCommands } from "./domains/index.ts";
import { sitesLinkCommand } from "./link.ts";
import { sitesListCommand } from "./list.ts";
import { sitesMigrateCommand } from "./migrate.ts";
import { sitesOpenCommand } from "./open.ts";
import { sitesShowCommand } from "./show.ts";
import { sitesSslCommand } from "./ssl.ts";
import { sitesUnlinkCommand } from "./unlink.ts";

const namespace = defineNamespace(
  "sites",
  "Host static sites (preview).",
  [
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
    sitesMigrateCommand,
  ],
);

export const sitesNamespace = {
  ...namespace,
  builder: (yargs: Argv) =>
    (namespace.builder as (y: Argv) => Argv)(yargs).middleware((argv) => {
      if (argv.output === "json") return;
      logger.info(
        "Sites is in Public Preview: commands may change. Report feedback and bugs at https://github.com/BunnyWay/cli/issues",
      );
    }),
};
