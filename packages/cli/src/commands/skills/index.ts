import { defineNamespace } from "../../core/define-namespace.ts";
import { skillsInstallCommand } from "./install.ts";
import { skillsRemoveCommand } from "./remove.ts";

export const skillsNamespace = defineNamespace(
  "skills",
  "Install agent skills for AI coding tools.",
  [skillsInstallCommand, skillsRemoveCommand],
);
