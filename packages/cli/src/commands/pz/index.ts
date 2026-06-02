import { defineNamespace } from "../../core/define-namespace.ts";
import { pzCloneCommand } from "./clone.ts";
import { pzCreateCommand } from "./create.ts";
import { pzDeleteCommand } from "./delete.ts";
import { pzDeselectCommand } from "./deselect.ts";
import { pzListCommand } from "./list.ts";
import { pzPurgeCommand } from "./purge.ts";
import { pzSelectCommand } from "./select.ts";
import { pzShowCommand } from "./show.ts";

// TODO: implement rules and hostnames subcommands
// const rulesNamespace = defineNamespace("rules", "Manage pull zone edge rules.", [...]);
// const hostnamesNamespace = defineNamespace("hostnames", "Manage pull zone hostnames.", [...]);

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
  ],
);
