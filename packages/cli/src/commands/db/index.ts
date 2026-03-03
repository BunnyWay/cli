import { defineNamespace } from "../../core/define-namespace.ts";
import { dbCreateCommand } from "./create.ts";
import { dbDeleteCommand } from "./delete.ts";
import { dbDocsCommand } from "./docs.ts";
import { dbListCommand } from "./list.ts";
import { dbQuickstartCommand } from "./quickstart.ts";
import { dbShellCommand } from "./shell.ts";
import { dbShowCommand } from "./show.ts";
import { dbUsageCommand } from "./usage.ts";
import { dbTokensNamespace } from "./tokens/index.ts";

export const dbNamespace = defineNamespace(
  "db",
  "Manage databases.",
  [dbCreateCommand, dbDeleteCommand, dbDocsCommand, dbListCommand, dbQuickstartCommand, dbShellCommand, dbShowCommand, dbUsageCommand, dbTokensNamespace],
);
