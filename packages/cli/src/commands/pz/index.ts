import type { CommandModule } from "yargs";
import { defineNamespace } from "../../core/define-namespace.ts";
import { pzCloneCommand } from "./clone.ts";
import { pzCreateCommand } from "./create.ts";
import { pzDeleteCommand } from "./delete.ts";
import { pzDeselectCommand } from "./deselect.ts";
import { pzListCommand } from "./list.ts";
import { pzPurgeCommand } from "./purge.ts";
import { pzSelectCommand } from "./select.ts";
import { pzShowCommand } from "./show.ts";



const rulesList: CommandModule = {
  command: "list <id>",
  describe: "List edge rules for a pull zone.",
  handler: () => {},
};

const rulesAdd: CommandModule = {
  command: "add <id> <file>",
  describe: "Add or update an edge rule from a JSON file.",
  handler: () => {},
};

const rulesExport: CommandModule = {
  command: "export <id> <name> [file]",
  describe: "Export an edge rule by name to JSON file or stdout.",
  handler: () => {},
};

const rulesCopy: CommandModule = {
  command: "copy <source> <target>",
  describe: "Copy all edge rules from one pull zone to another.",
  handler: () => {},
};

const rulesDelete: CommandModule = {
  command: "delete <id> <guid>",
  describe: "Delete an edge rule by GUID.",
  handler: () => {},
};

const rulesToggle: CommandModule = {
  command: "toggle <id> <guid> <state>",
  describe: "Enable or disable an edge rule.",
  handler: () => {},
};

const hostnamesList: CommandModule = {
  command: "list <id>",
  describe: "List hostnames for a pull zone.",
  handler: () => {},
};

const hostnamesAdd: CommandModule = {
  command: "add <id> <hostname>",
  describe: "Add a hostname to a pull zone.",
  handler: () => {},
};

const hostnamesRemove: CommandModule = {
  command: "remove <id> <hostname>",
  describe: "Remove a hostname from a pull zone.",
  handler: () => {},
};

const hostnamesCert: CommandModule = {
  command: "cert <id> <hostname>",
  describe: "Provision a Let's Encrypt SSL certificate for a hostname.",
  handler: () => {},
};

const hostnamesForceSsl: CommandModule = {
  command: "forcessl <id> <hostname> <state>",
  describe: "Enable or disable Force SSL for a hostname.",
  handler: () => {},
};

const rulesNamespace = defineNamespace("rules", "Manage pull zone edge rules.", [
  rulesList,
  rulesAdd,
  rulesExport,
  rulesCopy,
  rulesDelete,
  rulesToggle,
]);

const hostnamesNamespace = defineNamespace("hostnames", "Manage pull zone hostnames.", [
  hostnamesList,
  hostnamesAdd,
  hostnamesRemove,
  hostnamesCert,
  hostnamesForceSsl,
]);

export const pzNamespace = defineNamespace(
  "pz",
  "Manage pull zones.",
  [
    pzListCommand,
    pzCreateCommand,
    pzCloneCommand,
    pzDeleteCommand,
    pzSelectCommand,
    pzPurgeCommand,
    pzShowCommand,
    pzDeselectCommand,
    rulesNamespace,
    hostnamesNamespace,
  ],
);
