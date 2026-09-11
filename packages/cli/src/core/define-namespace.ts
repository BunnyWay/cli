import type { Argv, CommandModule } from "yargs";
import { bunny } from "./colors.ts";
import { groupHelpOptions } from "./define-command.ts";
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
      // A default (`$0`) subcommand groups its own flags ahead of the globals itself; grouping here first would push them below.
      if (!subcommands.some((sub) => hasDefaultCommand(sub))) {
        groupHelpOptions(yargs);
      }
      return yargs;
    },
    handler: async () => {
      try {
        const helpText = await yRef.getHelp();
        const colored = helpText
          .replace(/^Commands:/m, bunny.bold("Commands:"))
          .replace(/^Options:/m, bunny.bold("Options:"));
        console.log(colored);
      } catch (err) {
        console.error("Failed to load help text:", err);
      }
    },
  };
}

function hasDefaultCommand(sub: CommandModule): boolean {
  const names = Array.isArray(sub.command) ? sub.command : [sub.command];

  return names.includes("$0");
}
