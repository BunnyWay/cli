import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VIEW_EXT = ".sql";
const VIEW_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** Get the default views directory for a given database ID. */
export function getDefaultViewsDir(databaseId: string): string {
  const configDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configDir, "bunny", "views", databaseId);
}

/** Validate a view name (alphanumeric, hyphens, underscores). */
export function isValidViewName(name: string): boolean {
  return VIEW_NAME_RE.test(name);
}

/** Ensure the views directory exists. */
function ensureDir(viewsDir: string): void {
  if (!existsSync(viewsDir)) mkdirSync(viewsDir, { recursive: true });
}

/** Save a SQL query as a named view. */
export function saveView(viewsDir: string, name: string, sql: string): void {
  ensureDir(viewsDir);
  writeFileSync(join(viewsDir, name + VIEW_EXT), sql, "utf-8");
}

/** Load a named view and return its SQL, or null if it doesn't exist. */
export function loadView(viewsDir: string, name: string): string | null {
  const path = join(viewsDir, name + VIEW_EXT);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8").trim();
}

/** Delete a named view. Returns true if deleted, false if not found. */
export function deleteView(viewsDir: string, name: string): boolean {
  const path = join(viewsDir, name + VIEW_EXT);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** List all saved view names for the current views directory. */
export function listViews(viewsDir: string): string[] {
  if (!existsSync(viewsDir)) return [];
  return readdirSync(viewsDir)
    .filter((f) => f.endsWith(VIEW_EXT))
    .map((f) => f.slice(0, -VIEW_EXT.length))
    .sort();
}
