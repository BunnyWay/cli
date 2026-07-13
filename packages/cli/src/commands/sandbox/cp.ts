import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { SandboxError } from "@bunny.net/sandbox";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import { connectSandbox, parseRemoteRef } from "./resolve.ts";

interface CpArgs {
  source: string;
  dest: string;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export const sandboxCpCommand = defineCommand<CpArgs>({
  command: "cp <source> <dest>",
  describe: "Copy files between your machine and a sandbox.",
  examples: [
    ["$0 sandbox cp ./app.js my-sandbox:/workplace/app.js", "Upload a file"],
    [
      "$0 sandbox cp ./app.js my-sandbox:app.js",
      "Upload (relative to workplace)",
    ],
    [
      "$0 sandbox cp my-sandbox:/workplace/out.log ./out.log",
      "Download a file",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("source", {
        type: "string",
        demandOption: true,
        describe: "Source path (local, or <sandbox>:<path>)",
      })
      .positional("dest", {
        type: "string",
        demandOption: true,
        describe: "Destination path (local, or <sandbox>:<path>)",
      }),

  handler: async ({ source, dest, profile, apiKey, verbose, output }) => {
    const srcRemote = parseRemoteRef(source);
    const destRemote = parseRemoteRef(dest);

    if (srcRemote && destRemote) {
      throw new UserError(
        "Sandbox-to-sandbox copies are not supported. One side must be a local path.",
      );
    }
    const ref = srcRemote ?? destRemote;
    if (!ref) {
      throw new UserError(
        "One path must reference a sandbox as <sandbox>:<path>.",
      );
    }
    const sandbox = connectSandbox(ref.sandbox, profile, apiKey, verbose);

    const uploading = Boolean(destRemote);
    const spin = spinner(uploading ? "Uploading..." : "Downloading...");
    spin.start();

    let from: string;
    let to: string;
    try {
      if (uploading) {
        const local = source;
        const info = await stat(local).catch(() => null);
        if (!info) {
          throw new UserError(`Local file not found: ${local}`);
        }
        if (info.isDirectory()) {
          throw new UserError(
            `${local} is a directory. Only single files can be copied.`,
          );
        }
        // A trailing slash on the remote path means "into this directory".
        const remotePath = ref.path.endsWith("/")
          ? `${ref.path}${basename(local)}`
          : ref.path;
        const content = Buffer.from(await Bun.file(local).arrayBuffer());
        await sandbox.writeFiles([
          { path: remotePath, content, mode: info.mode & 0o777 },
        ]);
        from = local;
        to = `${ref.sandbox}:${remotePath}`;
      } else {
        const content = await sandbox.readFile(ref.path);
        if (content === null) {
          throw new UserError(`File not found in sandbox: ${ref.path}`);
        }
        // An existing local directory (or trailing slash) means "into it".
        const localPath =
          dest.endsWith("/") || (await isDirectory(dest))
            ? join(dest, basename(ref.path))
            : dest;
        await Bun.write(localPath, content);
        from = `${ref.sandbox}:${ref.path}`;
        to = localPath;
      }
    } catch (err) {
      spin.stop();
      if (err instanceof SandboxError) throw new UserError(err.message);
      throw err;
    } finally {
      sandbox.disconnect();
    }

    spin.stop();

    if (output === "json") {
      logger.log(JSON.stringify({ from, to }, null, 2));
      return;
    }
    logger.log(`Copied ${from} -> ${to}`);
  },
});
