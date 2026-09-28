import { defineNamespace } from "@/core/define-namespace.ts";
import { dbCreateCommand } from "./create.ts";
import { dbDeleteCommand } from "./delete.ts";
import { dbDocsCommand } from "./docs.ts";
import { dbLinkCommand } from "./link.ts";
import { dbListCommand } from "./list.ts";
import { dbMigrationsNamespace } from "./migrations/index.ts";
import { dbQuickstartCommand } from "./quickstart.ts";
import { dbRegionsNamespace } from "./regions/index.ts";
import { dbShellCommand } from "./shell.ts";
import { dbShowCommand } from "./show.ts";
import { dbStudioCommand } from "./studio.ts";
import { dbTokensNamespace } from "./tokens/index.ts";
import { dbUsageCommand } from "./usage.ts";

export const dbNamespace = defineNamespace("db", "Manage databases.", [
  dbCreateCommand,
  dbListCommand,
  dbShowCommand,
  dbUsageCommand,
  dbShellCommand,
  dbStudioCommand,
  dbQuickstartCommand,
  dbLinkCommand,
  dbTokensNamespace,
  dbMigrationsNamespace,
  dbRegionsNamespace,
  dbDocsCommand,
  dbDeleteCommand,
]);
