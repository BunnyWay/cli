import type { CommandModule } from "yargs";
import { registryAddCommand } from "./add.ts";
import { registryListCommand } from "./list.ts";
import { registryRemoveCommand } from "./remove.ts";
import { registryUpdateCommand } from "./update.ts";

// Not defineNamespace: a bare `apps registries` lists rather than demanding a subcommand.
export const appsRegistriesNamespace: CommandModule = {
  command: "registries",
  describe: false as never,
  builder: (yargs) => {
    yargs.command(registryAddCommand);
    yargs.command(registryListCommand);
    yargs.command(registryRemoveCommand);
    yargs.command(registryUpdateCommand);
    return yargs;
  },
  handler: registryListCommand.handler,
};
