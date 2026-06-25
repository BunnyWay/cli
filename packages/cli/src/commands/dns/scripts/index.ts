import { defineNamespace } from "../../../core/define-namespace.ts";
import { dnsScriptsConnectCommand } from "./connect.ts";
import { dnsScriptsCreateCommand } from "./create.ts";
import { dnsScriptsInitCommand } from "./init.ts";
import { dnsScriptsListCommand } from "./list.ts";
import { dnsScriptsPublishCommand } from "./publish.ts";
import { dnsScriptsSaveCommand } from "./save.ts";

export const dnsScriptsNamespace = defineNamespace(
  "scripts",
  "Manage Scriptable DNS scripts.",
  [
    dnsScriptsInitCommand,
    dnsScriptsCreateCommand,
    dnsScriptsSaveCommand,
    dnsScriptsPublishCommand,
    dnsScriptsConnectCommand,
    dnsScriptsListCommand,
  ],
  ["script"],
);
