// Public API
export { createShellClient } from "./client.ts";
export type { MaskType } from "./format.ts";
export {
  columnMaskType,
  csvEscape,
  formatValue,
  formatValueRaw,
  isSensitiveColumn,
  maskEmail,
  printResultSet,
} from "./format.ts";
export { getHistoryPath, loadHistory, saveHistory } from "./history.ts";

// Utilities (exported for testing and advanced usage)
export { splitStatements } from "./parser.ts";
export { executeFile, executeQuery, startShell } from "./shell.ts";
// Types
export type {
  ExecuteOptions,
  PrintMode,
  ShellLogger,
  ShellOptions,
} from "./types.ts";
export { PRINT_MODES } from "./types.ts";
export {
  deleteView,
  getDefaultViewsDir,
  isValidViewName,
  listViews,
  loadView,
  saveView,
} from "./views.ts";
