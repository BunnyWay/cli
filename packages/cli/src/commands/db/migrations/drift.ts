import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import type { MigrationStatus } from "./engine.ts";

const UNSAFE_STATES: ReadonlySet<MigrationStatus["state"]> = new Set([
  "modified",
  "missing",
  "out_of_order",
]);

/** History discrepancies that make applying more files ambiguous. */
export function migrationHistoryIssues(
  statuses: MigrationStatus[],
): MigrationStatus[] {
  return statuses.filter((status) => UNSAFE_STATES.has(status.state));
}

/** Refuse to extend an ambiguous history unless the caller explicitly opts in. */
export function assertMigrationHistorySafe(
  statuses: MigrationStatus[],
  allowDrift: boolean,
): void {
  if (allowDrift || migrationHistoryIssues(statuses).length === 0) return;

  throw new UserError(
    "Migration history needs attention; no migrations were applied.",
    "Run `bunny db migrations list` for details. Restore or rename the affected files, or re-run with `--allow-drift` if this history is intentional.",
  );
}

/**
 * Warn when the files on disk no longer describe what the database has applied.
 *
 * `list` always reports these states. `apply` prints the same detail before
 * refusing to extend the history unless `--allow-drift` was explicit.
 */
export function warnOnDrift(statuses: MigrationStatus[]): void {
  const modified = statuses.filter((s) => s.state === "modified");
  const missing = statuses.filter((s) => s.state === "missing");
  const outOfOrder = statuses.filter((s) => s.state === "out_of_order");

  if (modified.length > 0) {
    logger.log("");
    logger.warn(
      `${modified.length} applied migration${modified.length === 1 ? " has" : "s have"} changed since being applied:`,
    );
    for (const s of modified) logger.dim(`  ${s.name}`);
    logger.dim(
      "  The database was not updated. Add a new migration instead of editing an applied one.",
    );
  }

  if (missing.length > 0) {
    logger.log("");
    logger.warn(
      `${missing.length} applied migration${missing.length === 1 ? "" : "s"} no longer exist${missing.length === 1 ? "s" : ""} on disk:`,
    );
    for (const s of missing) logger.dim(`  ${s.name}`);
  }

  if (outOfOrder.length > 0) {
    logger.log("");
    logger.warn(
      `${outOfOrder.length} pending migration${outOfOrder.length === 1 ? " sorts" : "s sort"} before an already-applied migration:`,
    );
    for (const s of outOfOrder) logger.dim(`  ${s.name}`);
    logger.dim(
      "  Applying it now would make the recorded execution order differ from filename order.",
    );
  }
}
