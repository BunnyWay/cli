/**
 * `bunny lab`
 *
 * Commands we are still shaping. The name is the warning: the interface can
 * change between releases, and a workflow built on one should expect to be
 * updated.
 *
 * Astro is the first. It has two commands and no more: deploy the project, or
 * take it down again.
 */
import { defineNamespace } from "../../core/define-namespace.ts";
import { labDeployAstroCommand } from "./astro/deploy.ts";
import { labUndeployAstroCommand } from "./astro/undeploy.ts";

const deployNamespace = defineNamespace(
  "deploy <framework>",
  "Deploy a framework project that renders pages per request.",
  [labDeployAstroCommand],
);

const undeployNamespace = defineNamespace(
  "undeploy <framework>",
  "Delete a framework project and the resources it runs on.",
  [labUndeployAstroCommand],
);

export const labNamespace = defineNamespace("lab", false, [
  deployNamespace,
  undeployNamespace,
]);
