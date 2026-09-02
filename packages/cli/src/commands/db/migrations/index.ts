import { defineNamespace } from "@/core/define-namespace.ts";
import { dbMigrationsApplyCommand } from "./apply.ts";
import { dbMigrationsCreateCommand } from "./create.ts";
import { dbMigrationsListCommand } from "./list.ts";

export const dbMigrationsNamespace = defineNamespace(
  "migrations",
  "Create and apply SQL migrations. (experimental)",
  [
    dbMigrationsApplyCommand,
    dbMigrationsCreateCommand,
    dbMigrationsListCommand,
  ],
);
