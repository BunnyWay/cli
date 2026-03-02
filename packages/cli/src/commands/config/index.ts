import { defineNamespace } from "../../core/define-namespace.ts";
import { configShowCommand } from "./show.ts";
import { configInitCommand } from "./init.ts";
import { profileNamespace } from "./profile/index.ts";

export const configNamespace = defineNamespace(
  "config",
  "Manage CLI configuration.",
  [configInitCommand, configShowCommand, profileNamespace],
);
