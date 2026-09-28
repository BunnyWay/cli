import { defineNamespace } from "@/core/define-namespace.ts";
import { profileCreateCommand } from "./create.ts";
import { profileDeleteCommand } from "./delete.ts";
import { profileListCommand } from "./list.ts";

export const profileNamespace = defineNamespace(
  "profile",
  "Manage configuration profiles.",
  [profileCreateCommand, profileDeleteCommand, profileListCommand],
);
