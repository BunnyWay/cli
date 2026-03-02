import { defineNamespace } from "../../core/define-namespace.ts";
import { authLoginCommand } from "./login.ts";
import { authLogoutCommand } from "./logout.ts";

export const authNamespace = defineNamespace(
  "auth",
  "Authenticate with bunny.net.",
  [authLoginCommand, authLogoutCommand],
);
