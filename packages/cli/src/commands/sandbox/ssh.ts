import { getSandbox } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { WORKPLACE } from "./ssh-exec.ts";

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

    const [host, portStr] = (
      record.ssh_host.includes(":")
        ? record.ssh_host.split(":")
        : [record.ssh_host, "8023"]
    ) as [string, string];

    const proc = Bun.spawn(
      [
        "sshpass",
        "-p",
        record.agent_token,
        "ssh",
        "-t",
        "-p",
        portStr,
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        `root@${host}`,
        `cd ${WORKPLACE} && exec bash -l`,
      ],
      { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );

    process.exitCode = await proc.exited;
  },
});
