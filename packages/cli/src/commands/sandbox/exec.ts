import { getSandbox } from "../../config/index.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { collectEnv, type EnvOptionArgs, withEnvOptions } from "./env-args.ts";
import { envPrefix, sshArgs, WORKPLACE, withSshEnv } from "./ssh-exec.ts";

interface ExecArgs extends EnvOptionArgs {
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
    [
      "$0 sandbox exec my-sandbox --env DEBUG=1 -- node app.js",
      "Run with a temporary environment variable",
    ],
  ],

  builder: (yargs) =>
    withEnvOptions(
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
      { shortAlias: false },
    ),

  handler: async ({ name, command, cwd, env, envFile }) => {
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
    const remoteCmd = `cd ${JSON.stringify(cwd)} && ${prefix}${command
      .map((arg) => JSON.stringify(arg))
      .join(" ")}`;

    process.exitCode = await withSshEnv(record, async (env) => {
      const proc = Bun.spawn(sshArgs(record, remoteCmd), {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env,
      });
      return proc.exited;
    });
  },
});
