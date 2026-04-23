import { defineNamespace } from "../../core/define-namespace.ts";
import { scriptsCreateCommand } from "./create.ts";
import { scriptsDeleteCommand } from "./delete.ts";
import { scriptsDeployCommand } from "./deploy.ts";
import { scriptsDeploymentsNamespace } from "./deployments/index.ts";
import { scriptsDocsCommand } from "./docs.ts";
import { scriptsEnvNamespace } from "./env/index.ts";
import { scriptsInitCommand } from "./init.ts";
import { scriptsLinkCommand } from "./link.ts";
import { scriptsListCommand } from "./list.ts";
import { scriptsShowCommand } from "./show.ts";

export const scriptsNamespace = defineNamespace(
  "scripts",
  "Manage Edge Scripts.",
  [
    scriptsCreateCommand,
    scriptsDeleteCommand,
    scriptsDeployCommand,
    scriptsDeploymentsNamespace,
    scriptsDocsCommand,
    scriptsEnvNamespace,
    scriptsInitCommand,
    scriptsLinkCommand,
    scriptsListCommand,
    scriptsShowCommand,
  ],
);
