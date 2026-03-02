import { defineNamespace } from "../../../core/define-namespace.ts";
import { dbTokensCreateCommand } from "./create.ts";
import { dbTokensInvalidateCommand } from "./invalidate.ts";

export const dbTokensNamespace = defineNamespace(
  "tokens",
  "Manage database auth tokens.",
  [dbTokensCreateCommand, dbTokensInvalidateCommand],
);
