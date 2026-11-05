import { defineNamespace } from "@/core/define-namespace.ts";
import { withPreviewNotice } from "@/core/preview-notice.ts";
import { appsDeleteCommand } from "./delete.ts";
import { appsDeployCommand } from "./deploy.ts";
import { appsEndpointsNamespace } from "./endpoints/index.ts";
import { appsEnvNamespace } from "./env/index.ts";
import { appsInitCommand } from "./init.ts";
import { appsLinkCommand } from "./link.ts";
import { appsListCommand } from "./list.ts";
import { appsPullCommand } from "./pull.ts";
import { appsPushCommand } from "./push.ts";
import { appsRegionsNamespace } from "./regions/index.ts";
import { appsRegistriesNamespace } from "./registries/index.ts";
import { appsRestartCommand } from "./restart.ts";
import { appsShowCommand } from "./show.ts";
import { appsUndeployCommand } from "./undeploy.ts";
import { appsUnlinkCommand } from "./unlink.ts";
import { appsVolumesNamespace } from "./volumes/index.ts";

export const appsNamespace = withPreviewNotice(
  defineNamespace("apps", "Deploy container apps (preview).", [
    appsDeleteCommand,
    appsDeployCommand,
    appsEndpointsNamespace,
    appsEnvNamespace,
    appsInitCommand,
    appsLinkCommand,
    appsListCommand,
    appsPullCommand,
    appsPushCommand,
    appsRegionsNamespace,
    appsRegistriesNamespace,
    appsRestartCommand,
    appsShowCommand,
    appsUndeployCommand,
    appsUnlinkCommand,
    appsVolumesNamespace,
  ]),
);
