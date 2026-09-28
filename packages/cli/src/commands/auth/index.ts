import { defineNamespace } from "@/core/define-namespace.ts";
import { authLoginCommand } from "./login.ts";
import { authLogoutCommand } from "./logout.ts";

// Hidden mount for the muscle-memory form `bunny auth login`; the commands register at the root.
export const authNamespace = defineNamespace("auth", false, [
  authLoginCommand,
  authLogoutCommand,
]);
