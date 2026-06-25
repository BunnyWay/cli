import { defineNamespace } from "../../../core/define-namespace.ts";
import { dnsScriptsAttachCommand } from "./attach.ts";
import { dnsScriptsCreateCommand } from "./create.ts";
import { dnsScriptsDeployCommand } from "./deploy.ts";
import { dnsScriptsInitCommand } from "./init.ts";
import { dnsScriptsLinkCommand } from "./link.ts";
import { dnsScriptsListCommand } from "./list.ts";

export const dnsScriptsNamespace = defineNamespace(
  "scripts",
  "Manage Scriptable DNS scripts.",
  [
    dnsScriptsInitCommand,
    dnsScriptsCreateCommand,
    dnsScriptsDeployCommand,
    dnsScriptsAttachCommand,
    dnsScriptsLinkCommand,
    dnsScriptsListCommand,
  ],
  ["script"],
);
