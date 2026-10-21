import { type Dirent, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { UserError } from "./errors.ts";
import type { OutputFormat } from "./types.ts";
import { isInteractive, prompts } from "./ui.ts";

// Choice value for "type a path instead"; a NUL byte can't appear in a file name.
const OTHER_PATH = "\0other";

/** Files in `dir` with one of `extensions` (lowercase, with the dot), sorted by name. */
export function matchingFiles(
  dir: string,
  extensions: readonly string[],
): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        extensions.includes(extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

// The prompt gets no shell expansion, so `~/clip.mp4` would otherwise be a relative path.
function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/")
    ? join(homedir(), path.slice(1))
    : path;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * A local file path: the argument when given, otherwise asked for.
 *
 * Interactively, the matching files in the current directory are offered first,
 * with "Another path..." to type one. Unattended runs (no TTY, `--output json`)
 * error with `usage` instead, before any API call.
 */
export async function localFileArg(
  file: string | undefined,
  opts: {
    output?: OutputFormat;
    /** What the file is, for the prompt and the error: "video file". */
    noun: string;
    /** Extensions to offer from the current directory, lowercase with the dot. */
    extensions: readonly string[];
    /** Example invocation shown when the path can't be asked for. */
    usage: string;
    /** Directory to offer files from; defaults to the working directory. */
    dir?: string;
  },
): Promise<string> {
  const given = file?.trim();
  if (given) return given;

  const missing = new UserError(
    `A ${opts.noun} is required.`,
    `Pass the path: ${opts.usage}`,
  );
  if (!isInteractive(opts.output)) throw missing;

  const candidates = matchingFiles(opts.dir ?? process.cwd(), opts.extensions);
  if (candidates.length > 0) {
    const { value } = await prompts({
      type: "select",
      name: "value",
      message: `${opts.noun[0]?.toUpperCase()}${opts.noun.slice(1)}:`,
      choices: [
        ...candidates.map((name) => ({ title: name, value: name })),
        { title: "Another path...", value: OTHER_PATH },
      ],
    });
    if (typeof value !== "string") throw missing;
    if (value !== OTHER_PATH) return join(opts.dir ?? ".", value);
  }

  const { value } = await prompts({
    type: "text",
    name: "value",
    message: `Path to the ${opts.noun}:`,
    validate: (input: string) => {
      const path = expandHome(input.trim());
      if (!path) return "Enter a path.";
      return isFile(path) || `Not a file: ${path}`;
    },
  });
  const path = typeof value === "string" ? expandHome(value.trim()) : "";
  if (!path) throw missing;
  return path;
}
