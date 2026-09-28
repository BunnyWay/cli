import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { shellQuoteIfNeeded } from "@/core/shell.ts";

/** Replays what the user typed against the new command path. */
export function rewriteCpCommand(args: readonly string[]): string {
  return `bunny sandbox files cp ${args.map(shellQuoteIfNeeded).join(" ")}`.trimEnd();
}

/** The old `bunny sandbox cp` path: without it yargs answers a stray `cp` with "Did you mean ls?". */
export const sandboxCpMovedCommand = defineCommand<{ args?: string[] }>({
  command: "cp [args..]",
  describe: "Moved to `bunny sandbox files cp`.",
  hidden: true,

  builder: (yargs) =>
    yargs.positional("args", { type: "string", array: true }) as any,

  handler: async ({ args }) => {
    throw new UserError(
      "`bunny sandbox cp` has moved to `bunny sandbox files cp`.",
      `Run: ${rewriteCpCommand(args ?? [])}`,
    );
  },
});
