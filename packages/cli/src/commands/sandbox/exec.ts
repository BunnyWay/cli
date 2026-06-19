import { getSandbox } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { sshArgs, WORKPLACE } from "./ssh-exec.ts";

interface ExecArgs {
  name: string;
  command: string[];
  cwd: string;
}

export const sandboxExecCommand = defineCommand<ExecArgs>({
  command: "exec <name> <command..>",
  describe: "Run a shell command inside a sandbox via SSH.",
  examples: [
    ["$0 sandbox exec my-sandbox uname -a", "Run a command"],
    [
      "$0 sandbox exec my-sandbox --cwd /tmp ls -la",
      "Run with a working directory",
    ],
  ],

  builder: (yargs) =>
    yargs
      .parserConfiguration({ "unknown-options-as-args": true })
      .positional("name", {
        type: "string",
        demandOption: true,
        describe: "Sandbox name",
      })
      .positional("command", {
        type: "string",
        array: true,
        demandOption: true,
        describe: "Command to execute",
      })
      .option("cwd", {
        type: "string",
        default: WORKPLACE,
        describe: "Working directory inside the sandbox",
      }),

  handler: async ({ name, command, cwd }) => {
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

    const remoteCmd = `cd ${cwd} && ${command.join(" ")}`;

    const proc = Bun.spawn(sshArgs(record, remoteCmd), {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    process.exitCode = await proc.exited;
  },
});
