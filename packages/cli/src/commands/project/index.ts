import { defineNamespace } from "../../core/define-namespace.ts";
import { projectAddDatabaseCommand } from "./add-database.ts";
import { projectAddScriptCommand } from "./add-script.ts";
import { projectDashboardCommand } from "./dashboard.ts";
import { projectInitCommand } from "./init.ts";
import { projectRemoveCommand } from "./remove.ts";
import { projectShowCommand } from "./show.ts";
import { projectValidateCommand } from "./validate.ts";

const projectAddNamespace = defineNamespace(
  "add",
  "Map an existing bunny.net resource into the project config.",
  [projectAddDatabaseCommand, projectAddScriptCommand],
);

export const projectNamespace = defineNamespace(
  "project",
  "Describe and map this project's bunny.net resources.",
  [
    projectInitCommand,
    projectShowCommand,
    projectValidateCommand,
    projectAddNamespace,
    projectRemoveCommand,
    projectDashboardCommand,
  ],
);
