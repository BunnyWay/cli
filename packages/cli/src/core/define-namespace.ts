import type { Argv, CommandModule } from "yargs";

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
      yRef.showHelp("log");
    },
  };
}
