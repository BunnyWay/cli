import { getSandbox } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { sshArgs, sshEnv, WORKPLACE } from "./ssh-exec.ts";

export const sandboxSshCommand = defineCommand({
  command: "ssh <name>",
  describe: "Open an interactive SSH session inside a sandbox.",
  examples: [["$0 sandbox ssh my-sandbox", "Open a shell in my-sandbox"]],

  builder: (yargs) =>
    yargs.positional("name", {
      type: "string",
      demandOption: true,
      describe: "Sandbox name",
    }),

  handler: async ({ name }) => {
    const record = getSandbox(name);
    if (!record) {
      throw new UserError(
        `No sandbox named "${name}" found. Run: bunny sandbox create ${name}`,
      );
    }
    if (!record.ssh_host) {
      throw new UserError(
        `Sandbox "${name}" has no SSH endpoint recorded. Re-create it.`,
      );
    }

    const proc = Bun.spawn(
      sshArgs(record, `cd ${WORKPLACE} && exec bash -l`, { tty: true }),
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: sshEnv(record),
      },
    );

    process.exitCode = await proc.exited;
  },
});
