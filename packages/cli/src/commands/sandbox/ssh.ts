import { getSandbox } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { collectEnv, type EnvOptionArgs, withEnvOptions } from "./env-args.ts";
import { envPrefix, sshArgs, WORKPLACE, withSshEnv } from "./ssh-exec.ts";

interface SshArgs extends EnvOptionArgs {
  name: string;
}

export const sandboxSshCommand = defineCommand<SshArgs>({
  command: "ssh <name>",
  describe: "Open an interactive SSH session inside a sandbox.",
  examples: [
    ["$0 sandbox ssh my-sandbox", "Open a shell in my-sandbox"],
    [
      "$0 sandbox ssh my-sandbox -e DEBUG=1",
      "Open a shell with a temporary environment variable",
    ],
  ],

  builder: (yargs) =>
    withEnvOptions(
      yargs.positional("name", {
        type: "string",
        demandOption: true,
        describe: "Sandbox name",
      }),
    ),

  handler: async ({ name, env, envFile }) => {
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

    const prefix = envPrefix(await collectEnv(env, envFile));
    process.exitCode = await withSshEnv(record, async (env) => {
      const proc = Bun.spawn(
        sshArgs(record, `cd ${WORKPLACE} && ${prefix}exec bash -l`, {
          tty: true,
        }),
        {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          env,
        },
      );
      return proc.exited;
    });
  },
});
