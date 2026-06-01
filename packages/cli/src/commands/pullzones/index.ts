import type { CommandModule } from "yargs";
import { defineNamespace } from "../../core/define-namespace.ts";
import { pullzonesCloneCommand } from "./clone.ts";
import { pullzonesCreateCommand } from "./create.ts";
import { pullzonesDeleteCommand } from "./delete.ts";
import { pullzonesDeselectCommand } from "./deselect.ts";
import { pullzonesListCommand } from "./list.ts";
import { pullzonesPurgeCommand } from "./purge.ts";
import { pullzonesSelectCommand } from "./select.ts";
import { pullzonesShowCommand } from "./show.ts";



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

export const pullzonesNamespace = defineNamespace(
  "pullzones",
  "Manage pull zones.",
  [
    pullzonesListCommand,
    pullzonesCreateCommand,
    pullzonesCloneCommand,
    pullzonesDeleteCommand,
    pullzonesSelectCommand,
    pullzonesPurgeCommand,
    pullzonesShowCommand,
    pullzonesDeselectCommand,
    rulesNamespace,
    hostnamesNamespace,
  ],
);
