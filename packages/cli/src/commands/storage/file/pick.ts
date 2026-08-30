import { formatBytes } from "../../../core/format.ts";
import { prompts, spinner } from "../../../core/ui.ts";
import { listFiles, type StorageFile, type StorageZone } from "../files-api.ts";

const UP = "\u0000up";
const HERE = "\u0000here";

// Directories sort first, then by name, matching `files list`.
function sortEntries(files: StorageFile[]): StorageFile[] {
  return files.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.objectName.localeCompare(b.objectName);
  });
}

function parentOf(dir: string): string {
  const trimmed = dir.replace(/\/$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut === -1 ? "" : `${trimmed.slice(0, cut)}/`;
}

async function listDir(
  connection: StorageZone,
  dir: string,
): Promise<StorageFile[]> {
  const spin = spinner("Listing files...");
  spin.start();
  try {
    return sortEntries(await listFiles(connection, dir));
  } finally {
    spin.stop();
  }
}

/**
 * Browse a storage zone and pick a path, drilling into directories as you go.
 * Returns undefined when the user cancels.
 *
 * With `allowDirectories`, any directory below the root can be chosen as the
 * answer via a "select this directory" entry; the root itself never can, so
 * emptying a zone stays an explicit `files remove /`.
 * Callers must check `isInteractive` first: this always prompts.
 */
export async function promptStoragePath(
  connection: StorageZone,
  opts: { message: string; allowDirectories?: boolean },
): Promise<string | undefined> {
  let dir = "";

  for (;;) {
    const entries = await listDir(connection, dir);
    const choices: Array<{ title: string; value: string }> = [];

    if (dir) choices.push({ title: "../", value: UP });
    if (dir && opts.allowDirectories)
      choices.push({ title: `Select this directory (${dir})`, value: HERE });

    for (const entry of entries) {
      const path = `${dir}${entry.objectName}`;
      choices.push(
        entry.isDirectory
          ? { title: `${entry.objectName}/`, value: `${path}/` }
          : {
              title: `${entry.objectName}  ${formatBytes(entry.length)}`,
              value: path,
            },
      );
    }

    if (choices.length === 0) {
      // A dead end with no way back only happens at an empty root.
      if (!dir) return undefined;
      dir = parentOf(dir);
      continue;
    }

    const { picked } = await prompts({
      type: "select",
      name: "picked",
      message: dir ? `${opts.message} (${dir})` : opts.message,
      choices,
    });

    if (picked === undefined) return undefined;
    if (picked === UP) {
      dir = parentOf(dir);
      continue;
    }
    if (picked === HERE) return dir;

    // Directories drill in unless the caller wants one and this is a leaf choice.
    if (typeof picked === "string" && picked.endsWith("/")) {
      dir = picked;
      continue;
    }
    return picked as string;
  }
}
