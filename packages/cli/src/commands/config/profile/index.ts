import { defineNamespace } from "../../../core/define-namespace.ts";
import { profileCreateCommand } from "./create.ts";
import { profileDeleteCommand } from "./delete.ts";

export const profileNamespace = defineNamespace(
  "profile",
  "Manage configuration profiles.",
  [profileCreateCommand, profileDeleteCommand],
);
