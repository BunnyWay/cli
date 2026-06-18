import type { SandboxRecord } from "../../config/schema.ts";

export const WORKPLACE = "/workplace";

export function sshArgs(record: SandboxRecord, remoteCmd: string): string[] {
  const [host, portStr] = (record.ssh_host!.includes(":")
    ? record.ssh_host!.split(":")
    : [record.ssh_host!, "8023"]) as [string, string];

  return [
    "sshpass", "-p", record.agent_token,
    "ssh",
    "-p", portStr,
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
    `root@${host}`,
    remoteCmd,
  ];
}

export async function runSshCommand(record: SandboxRecord, remoteCmd: string): Promise<number> {
  const proc = Bun.spawn(sshArgs(record, remoteCmd), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}
