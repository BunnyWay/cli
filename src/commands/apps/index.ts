import { defineNamespace } from "../../core/define-namespace.ts";
import { appsAccessoryNamespace } from "./accessory/index.ts";
import { appsDeleteCommand } from "./delete.ts";
import { appsDeployCommand } from "./deploy.ts";
import { appsEndpointsNamespace } from "./endpoints/index.ts";
import { appsEnvNamespace } from "./env/index.ts";
import { appsInitCommand } from "./init.ts";
import { appsListCommand } from "./list.ts";
import { appsPullCommand } from "./pull.ts";
import { appsPushCommand } from "./push.ts";
import { appsRegionsNamespace } from "./regions/index.ts";
import { appsRegistryNamespace } from "./registry/index.ts";
import { appsRestartCommand } from "./restart.ts";
import { appsShowCommand } from "./show.ts";
import { appsUndeployCommand } from "./undeploy.ts";
import { appsVolumesNamespace } from "./volumes/index.ts";

export const appsNamespace = defineNamespace("apps", "Manage apps.", [
  appsAccessoryNamespace,
  appsDeleteCommand,
  appsDeployCommand,
  appsEndpointsNamespace,
  appsEnvNamespace,
  appsInitCommand,
  appsListCommand,
  appsPullCommand,
  appsPushCommand,
  appsRegionsNamespace,
  appsRegistryNamespace,
  appsRestartCommand,
  appsShowCommand,
  appsUndeployCommand,
  appsVolumesNamespace,
]);
