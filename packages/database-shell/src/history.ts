import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HISTORY_MAX = 1000;

/** Get the path to the shell history file. */
export function getHistoryPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configDir, "bunny", "shell_history");
}

/** Load shell history from disk. Returns an empty array if no history file exists. */
export function loadHistory(): string[] {
  const path = getHistoryPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.length > 0);
}

/** Save shell history to disk, truncating to the most recent entries. */
export function saveHistory(lines: string[]): void {
  const path = getHistoryPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${lines.slice(-HISTORY_MAX).join("\n")}\n`, "utf-8");
}
