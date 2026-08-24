import type { ShellClient } from "./client.ts";

/** Logger interface for the shell. Defaults to console-based output if not provided. */
export interface ShellLogger {
  log(msg?: string): void;
  error(msg: string): void;
  warn(msg: string): void;
  dim(msg: string): void;
  success(msg: string): void;
}

/** Output mode for result sets. */
export type PrintMode = "default" | "table" | "json" | "csv" | "markdown";

export const PRINT_MODES: PrintMode[] = [
  "default",
  "table",
  "json",
  "csv",
  "markdown",
];

/** Options for starting an interactive shell session. */
export interface ShellOptions {
  client: ShellClient;
  mode?: PrintMode;
  masked?: boolean;
  timing?: boolean;
  logger?: ShellLogger;
  /** Database identifier used to scope saved views. When set, enables .save/.view/.views/.unsave commands. */
  databaseId?: string;
  /** Override the directory where views are stored. Defaults to ~/.config/bunny/views/<databaseId>/. */
  viewsDir?: string;
}

/** Options for non-interactive query/file execution. */
export interface ExecuteOptions {
  mode?: PrintMode;
  masked?: boolean;
  timing?: boolean;
  logger?: ShellLogger;
}
