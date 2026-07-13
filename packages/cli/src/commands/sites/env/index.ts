import { defineNamespace } from "../../../core/define-namespace.ts";
import { sitesEnvListCommand } from "./list.ts";
import { sitesEnvPullCommand } from "./pull.ts";
import { sitesEnvRemoveCommand } from "./remove.ts";
import { sitesEnvSetCommand } from "./set.ts";

export const sitesEnvNamespace = defineNamespace(
  "env",
  "Manage a site's build-time environment variables.",
  [
    sitesEnvSetCommand,
    sitesEnvListCommand,
    sitesEnvRemoveCommand,
    sitesEnvPullCommand,
  ],
);
