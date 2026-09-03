import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";

/** Anything outside this set changes meaning once the hint is pasted back into a shell. */
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

function shellQuote(value: string): string {
  if (value === "") return "''";
  if (SHELL_SAFE.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Replays what the user typed against the new command path. */
export function rewriteCpCommand(args: readonly string[]): string {
  return `bunny sandbox files cp ${args.map(shellQuote).join(" ")}`.trimEnd();
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
