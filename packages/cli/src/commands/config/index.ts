import { defineNamespace } from "../../core/define-namespace.ts";
import { configInitCommand } from "./init.ts";
import { profileNamespace } from "./profile/index.ts";
import { configShowCommand } from "./show.ts";

export const configNamespace = defineNamespace(
  "config",
  "Manage CLI configuration.",
  [configInitCommand, configShowCommand, profileNamespace],
);
