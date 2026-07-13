import { SandboxError, type SandboxFileEntry } from "@bunny.net/sandbox";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatBytes, formatTable } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { connectSandbox, parseRemoteRef, type RemoteRef } from "./resolve.ts";

interface LsArgs {
  target: string;
}

/** A bare sandbox name lists the workplace; `sandbox:path` lists that path. */
export function parseLsTarget(target: string): RemoteRef {
  return parseRemoteRef(target) ?? { sandbox: target, path: "." };
}

export const sandboxLsCommand = defineCommand<LsArgs>({
  command: "ls <target>",
  describe: "List files in a sandbox directory.",
  examples: [
    ["$0 sandbox ls my-sandbox", "List /workplace"],
    ["$0 sandbox ls my-sandbox:/workplace/src", "List a directory"],
    ["$0 sandbox ls my-sandbox:src --output json", "List as JSON"],
  ],

  builder: (yargs) =>
    yargs.positional("target", {
      type: "string",
      demandOption: true,
      describe: "Sandbox name, or <sandbox>:<path> for a specific directory",
    }),

  handler: async ({ target, profile, apiKey, verbose, output }) => {
    const ref = parseLsTarget(target);
    const sandbox = connectSandbox(ref.sandbox, profile, apiKey, verbose);

    const spin = spinner("Listing...");
    spin.start();

    let entries: SandboxFileEntry[];
    try {
      entries = await sandbox.listFiles(ref.path);
      // listFiles maps a missing directory to []; tell them apart for a clear error.
      if (entries.length === 0 && !(await sandbox.exists(ref.path))) {
        throw new UserError(`No such directory in sandbox: ${ref.path}`);
      }
    } catch (err) {
      if (err instanceof SandboxError) throw new UserError(err.message);
      throw err;
    } finally {
      spin.stop();
      sandbox.disconnect();
    }

    if (output === "json") {
      logger.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (entries.length === 0) {
      logger.info("Empty directory.");
      return;
    }
    logger.log(
      formatTable(
        ["Name", "Type", "Size", "Mode"],
        entries.map((e) => [
          e.name,
          e.type,
          e.type === "file" ? formatBytes(e.size) : "",
          e.mode.toString(8).padStart(3, "0"),
        ]),
        output,
      ),
    );
  },
});
