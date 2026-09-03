import { getSandbox } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { collectEnv, type EnvOptionArgs, withEnvOptions } from "./env-args.ts";
import { envPrefix, sshArgs, WORKPLACE, withSshEnv } from "./ssh-exec.ts";

interface ExecArgs extends EnvOptionArgs {
  name: string;
  command?: string[];
  /** Arguments after a `--` separator, populated by yargs. */
  "--"?: string[];
  cwd: string;
  timeout?: number;
}

export const sandboxExecCommand = defineCommand<ExecArgs>({
  command: "exec <name> [command..]",
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
    [
      "$0 sandbox exec my-sandbox --timeout 30 -- bun run build",
      "Kill the command after 30 seconds",
    ],
  ],

  builder: (yargs) =>
    withEnvOptions(
      yargs
        .parserConfiguration({
          "unknown-options-as-args": true,
          "populate--": true,
        })
        .positional("name", {
          type: "string",
          demandOption: true,
          describe: "Sandbox name",
        })
        .positional("command", {
          type: "string",
          array: true,
          describe: "Command to execute",
        })
        .option("cwd", {
          type: "string",
          default: WORKPLACE,
          describe: "Working directory inside the sandbox",
        })
        .option("timeout", {
          type: "number",
          describe:
            "Close the SSH connection and exit 124 after this many seconds",
        }),
      { shortAlias: false },
    ),

  handler: async (args) => {
    const { name, cwd, env, envFile, timeout } = args;
    // The command may arrive as positionals, after a `--` separator, or both.
    const command = [...(args.command ?? []), ...(args["--"] ?? [])];
    if (command.length === 0) {
      throw new UserError("No command given. Usage: exec <name> <command..>");
    }
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
      throw new UserError("--timeout must be a positive number of seconds.");
    }
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
      let timedOut = false;
      const timer =
        timeout === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              proc.kill();
            }, timeout * 1000);
      const exitCode = await proc.exited;
      clearTimeout(timer);
      if (timedOut) {
        logger.error(`Command timed out after ${timeout}s.`);
        return 124;
      }
      return exitCode;
    });
  },
});
