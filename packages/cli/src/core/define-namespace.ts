import type { CommandModule } from "yargs";

/**
 * Groups subcommands under a parent namespace. Running the namespace
 * without a subcommand shows help (enforced via `demandCommand(1)`).
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
  describe: string,
  subcommands: CommandModule[],
): CommandModule {
  return {
    command,
    describe,
    builder: (yargs) => {
      for (const sub of subcommands) yargs.command(sub);
      return yargs.demandCommand(1, `Run \`bunny ${command} --help\` for usage.`);
    },
    handler: () => {},
  };
}
