import type { ResourceKind } from "@bunny.net/project-config";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadProjectConfig, removeBinding } from "../../core/project-config.ts";
import { ARG_BINDING, ARG_BINDING_DESCRIPTION } from "./shared.ts";

const COMMAND = `remove <${ARG_BINDING}>`;
const DESCRIPTION = "Remove a binding from the project config.";

interface RemoveArgs {
  [ARG_BINDING]: string;
}

/** Drop a binding from every resource map it appears in (the remote resource is untouched). */
export const projectRemoveCommand = defineCommand<RemoveArgs>({
  command: COMMAND,
  aliases: ["rm"],
  describe: DESCRIPTION,
  examples: [["$0 project remove db", "Unmap the `db` binding"]],

  builder: (yargs) =>
    yargs.positional(ARG_BINDING, {
      type: "string",
      describe: ARG_BINDING_DESCRIPTION,
      demandOption: true,
    }),

  handler: async (args) => {
    const { output } = args;
    const binding = args[ARG_BINDING];
    const config = loadProjectConfig();

    const kinds: ResourceKind[] = ["databases", "scripts"];
    const removed = kinds.filter((kind) => config[kind]?.[binding]);

    if (removed.length === 0) {
      throw new UserError(
        `No binding named "${binding}" in the project config.`,
        "Run `bunny project show` to list bindings.",
      );
    }

    for (const kind of removed) removeBinding(kind, binding);

    if (output === "json") {
      logger.log(JSON.stringify({ binding, removed }));
      return;
    }

    for (const kind of removed) {
      logger.success(`Removed ${kind}.${binding} from the project config.`);
    }
  },
});
