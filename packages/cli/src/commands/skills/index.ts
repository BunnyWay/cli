import { defineNamespace } from "../../core/define-namespace.ts";
import { skillsInstallCommand } from "./install.ts";

export const skillsNamespace = defineNamespace(
  "skills",
  "Install agent skills for AI coding tools.",
  [skillsInstallCommand],
);
