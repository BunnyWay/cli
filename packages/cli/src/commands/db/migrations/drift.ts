import { logger } from "../../../core/logger.ts";
import type { MigrationStatus } from "./engine.ts";

/**
 * Warn when the files on disk no longer describe what the database has applied.
 *
 * Both cases are reported rather than fatal: pending migrations can still be
 * applied safely, and the fix (restore the file, or re-create the change as a
 * new migration) is the developer's call.
 */
export function warnOnDrift(statuses: MigrationStatus[]): void {
  const modified = statuses.filter((s) => s.state === "modified");
  const missing = statuses.filter((s) => s.state === "missing");

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
}
