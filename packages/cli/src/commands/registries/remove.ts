import { registriesDelete } from "@bunny.net/actions";
import { defineActionCommand } from "../../core/define-action-command.ts";
import { logger } from "../../core/logger.ts";
import { confirm } from "../../core/ui.ts";

export const registryRemoveCommand = defineActionCommand({
  action: registriesDelete,
  command: "remove <registry-id>",
  describe: "Remove a container registry.",
  progress: "Removing registry...",

  builder: (yargs) =>
    yargs
      .positional("registry-id", {
        type: "number",
        describe: "Registry ID",
        demandOption: true,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "Skip confirmation prompt",
      }),

  prepare: async (args) => ({
    input: { registry: args["registry-id"] },
    confirm: () => confirm("Remove this registry?", { force: args.force }),
  }),

  render: () => {
    logger.success("Registry removed.");
  },
});
