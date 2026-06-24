import type { Argv, CommandModule } from "yargs";
import { bunny } from "../core/colors.ts";
/**
 * Groups subcommands under a parent namespace. Running the namespace
 * without a subcommand shows help.
 *
 * Pass `describe: false` to hide the namespace from help (e.g. a hidden
 * alias). Pass `aliases` to expose alternative names shown in help.
 *
 * @example
 * ```ts
 * export const authNamespace = defineNamespace(
 *   "auth",
 *   "Authenticate with bunny.net.",
 *   [loginCommand, logoutCommand],
 * );
 * ```
 */
export function defineNamespace(
  command: string,
  describe: string | false,
  subcommands: CommandModule[],
  aliases?: string[],
): CommandModule {
  let yRef: Argv;
  return {
    command,
    aliases,
    describe,
    builder: (yargs) => {
      yRef = yargs;
      for (const sub of subcommands) yargs.command(sub);
      return yargs;
    },
    handler: () => {
      yRef.getHelp().then((helpText) => {
        const colored = helpText
          .replace(/^Commands:/m, bunny.bold("Commands:"))
          .replace(/^Options:/m, bunny.bold("Options:"));
        console.log(colored);
      });
    },
  };
}
