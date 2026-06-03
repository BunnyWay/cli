import { defineNamespace } from "../../core/define-namespace.ts";
import { pzCreateCommand } from "./create.ts";
import { pzDeleteCommand } from "./delete.ts";
import { pzLinkCommand } from "./link.ts";
import { pzListCommand } from "./list.ts";
import { pzPurgeCommand } from "./purge.ts";
import { pzShowCommand } from "./show.ts";
import { pzUnlinkCommand } from "./unlink.ts";

// TODO: implement rules and hostnames subcommands
// const rulesNamespace = defineNamespace("rules", "Manage pull zone edge rules.", [...]);
// const hostnamesNamespace = defineNamespace("hostnames", "Manage pull zone hostnames.", [...]);

export const pzNamespace = defineNamespace(
  "pz",
  "Manage pull zones.",
  [
    pzListCommand,
    pzCreateCommand,
    pzDeleteCommand,
    pzLinkCommand,
    pzPurgeCommand,
    pzShowCommand,
    pzUnlinkCommand,
  ],
);
