import type { SandboxRecord } from "../../config/schema.ts";

export const WORKPLACE = "/workplace";

export function sshArgs(
  record: SandboxRecord,
  remoteCmd: string,
  options: { tty?: boolean } = {},
): string[] {
  const sshHost = record.ssh_host ?? "localhost";
  const [host, portStr] = (
    sshHost.includes(":") ? sshHost.split(":") : [sshHost, "8023"]
  ) as [string, string];

  // Use `sshpass -e` so the token is read from the SSHPASS env var rather than
  // passed as `-p <token>`, which would expose it in the process argument list
  // to any other user on the machine. Callers must spawn with `sshEnv(record)`.
  return [
    "sshpass",
    "-e",
    "ssh",
    ...(options.tty ? ["-t"] : []),
    "-p",
    portStr,
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "LogLevel=ERROR",
    `root@${host}`,
    remoteCmd,
  ];
}

/**
 * Environment for spawning the `sshpass -e` command produced by `sshArgs`.
 * Keeps the agent token out of the process argument list.
 */
export function sshEnv(record: SandboxRecord): Record<string, string> {
  return { ...process.env, SSHPASS: record.agent_token };
}

export async function runSshCommand(
  record: SandboxRecord,
  remoteCmd: string,
): Promise<number> {
  const proc = Bun.spawn(sshArgs(record, remoteCmd), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: sshEnv(record),
  });
  return proc.exited;
}
