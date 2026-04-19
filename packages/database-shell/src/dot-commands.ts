import type * as readline from "node:readline";
import type { Client } from "@libsql/client";
import {
  EMAIL_SUBSTRINGS,
  printResultSet,
  SENSITIVE_PREFIXES,
  SENSITIVE_SUBSTRINGS,
} from "./format.ts";
import { saveHistory } from "./history.ts";
import type { PrintMode, ShellLogger } from "./types.ts";
import {
  deleteView,
  isValidViewName,
  listViews,
  loadView,
  saveView,
} from "./views.ts";

/** Prompt the user with a yes/no question via the REPL interface. */
function askConfirm(rl: readline.Interface, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

/**
 * Warn about read quota impact and ask for confirmation.
 * Used by dot-commands that perform full table scans (`.count`, `.dump`, `.size`).
 */
async function confirmReadQuota(
  rl: readline.Interface,
  message: string,
  logger: ShellLogger,
): Promise<boolean> {
  logger.warn(message);
  return askConfirm(rl, "Continue?");
}

function printMaskedPatterns(logger: ShellLogger, indent = "  "): void {
  logger.dim(
    `${indent}Full mask: ${[...SENSITIVE_PREFIXES.map((p) => `${p}*`), ...SENSITIVE_SUBSTRINGS].join(", ")}`,
  );
  logger.dim(`${indent}Email mask: ${EMAIL_SUBSTRINGS.join(", ")}`);
}

export interface ShellState {
  mode: PrintMode;
  masked: boolean;
  timing: boolean;
  lastStatement: string | null;
  viewsDir: string | null;
}

/**
 * Dispatch a dot-command (e.g. `.tables`, `.schema`, `.quit`) and return
 * whether it was handled, unrecognised, or requested an exit.
 */
export async function executeDotCommand(
  command: string,
  client: Client,
  state: ShellState,
  rl: readline.Interface,
  logger: ShellLogger,
): Promise<"quit" | "handled" | "unknown"> {
  const parts = command.trim().replace(/;+$/, "").split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const PRINT_MODES: PrintMode[] = [
    "default",
    "table",
    "json",
    "csv",
    "markdown",
  ];

  switch (cmd) {
    case ".quit":
    case ".exit":
      return "quit";

    case ".tables": {
      const result = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      );
      printResultSet(result, state.mode, state.masked, logger);
      return "handled";
    }

    case ".schema": {
      const tableName = parts[1];
      const sql = tableName
        ? `SELECT sql FROM sqlite_master WHERE name='${tableName.replace(/'/g, "''")}'`
        : "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name";
      const result = await client.execute(sql);

      if (state.mode === "json" || state.mode === "csv") {
        printResultSet(result, state.mode, state.masked, logger);
      } else {
        for (const row of result.rows) {
          if (row[0]) logger.log(`${String(row[0])};`);
        }
      }
      return "handled";
    }

    case ".indexes": {
      const tableName = parts[1];
      const sql = tableName
        ? `SELECT name, tbl_name as 'table' FROM sqlite_master WHERE type='index' AND tbl_name='${tableName.replace(/'/g, "''")}' ORDER BY name`
        : "SELECT name, tbl_name as 'table' FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name";
      const result = await client.execute(sql);
      printResultSet(result, state.mode, state.masked, logger);
      return "handled";
    }

    case ".describe": {
      const tableName = parts[1];
      if (!tableName) {
        logger.error("Usage: .describe TABLE");
        return "handled";
      }
      const result = await client.execute(
        `SELECT name, type, CASE WHEN "notnull" THEN 'NOT NULL' ELSE '' END as nullable, dflt_value as default_value, CASE WHEN pk THEN 'YES' ELSE '' END as primary_key FROM pragma_table_info('${tableName.replace(/'/g, "''")}')`,
      );
      if (result.rows.length === 0) {
        logger.error(`Table not found: ${tableName}`);
      } else {
        printResultSet(result, state.mode, state.masked, logger);
      }
      return "handled";
    }

    case ".count": {
      const tableName = parts[1];
      if (!tableName) {
        logger.error("Usage: .count TABLE");
        return "handled";
      }
      if (
        !(await confirmReadQuota(
          rl,
          "This will scan all rows and count against your read quota.",
          logger,
        ))
      )
        return "handled";

      const result = await client.execute(
        `SELECT COUNT(*) as count FROM "${tableName.replace(/"/g, '""')}"`,
      );
      printResultSet(result, state.mode, state.masked, logger);
      return "handled";
    }

    case ".dump": {
      const tableName = parts[1];
      const dumpMsg = tableName
        ? `This will read all rows from "${tableName}" and count against your read quota.`
        : "This will read all rows from every table and count against your read quota.";
      if (!(await confirmReadQuota(rl, dumpMsg, logger))) return "handled";

      const tables = tableName
        ? [tableName]
        : (
            await client.execute(
              "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
            )
          ).rows.map((r) => String(r[0]));

      for (const tbl of tables) {
        const escaped = tbl.replace(/'/g, "''");
        const schema = await client.execute(
          `SELECT sql FROM sqlite_master WHERE name='${escaped}'`,
        );
        if (schema.rows[0]?.[0]) {
          logger.log(`${String(schema.rows[0][0])};`);
        }

        const data = await client.execute(
          `SELECT * FROM "${tbl.replace(/"/g, '""')}"`,
        );
        for (const row of data.rows) {
          const values = data.columns.map((_, i) => {
            const val = row[i];
            if (val === null) return "NULL";
            if (typeof val === "number" || typeof val === "bigint")
              return String(val);
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          logger.log(
            `INSERT INTO "${tbl.replace(/"/g, '""')}" VALUES (${values.join(", ")});`,
          );
        }
        logger.log();
      }
      return "handled";
    }

    case ".fk": {
      const tableName = parts[1];
      if (!tableName) {
        logger.error("Usage: .fk TABLE");
        return "handled";
      }
      const escaped = tableName.replace(/'/g, "''");
      const result = await client.execute(
        `SELECT id, "table" as referenced_table, "from" as column_name, "to" as referenced_column, on_update, on_delete FROM pragma_foreign_key_list('${escaped}')`,
      );
      if (result.rows.length === 0) {
        logger.dim(`  No foreign keys on ${tableName}.`);
      } else {
        printResultSet(result, state.mode, state.masked, logger);
      }
      return "handled";
    }

    case ".truncate": {
      const tableName = parts[1];
      if (!tableName) {
        logger.error("Usage: .truncate TABLE");
        return "handled";
      }
      const escaped = tableName.replace(/'/g, "''");
      const exists = await client.execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${escaped}'`,
      );
      if (exists.rows.length === 0) {
        logger.error(`Table not found: ${tableName}`);
        return "handled";
      }
      if (!(await askConfirm(rl, `Delete all rows from "${tableName}"?`)))
        return "handled";

      const result = await client.execute(
        `DELETE FROM "${tableName.replace(/"/g, '""')}"`,
      );
      logger.success(
        `${result.rowsAffected} row${result.rowsAffected === 1 ? "" : "s"} deleted from ${tableName}.`,
      );
      return "handled";
    }

    case ".er": {
      const tables = (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
      ).rows.map((r) => String(r[0]));

      if (tables.length === 0) {
        logger.dim("  No tables found.");
        return "handled";
      }

      for (const tbl of tables) {
        const escaped = tbl.replace(/'/g, "''");
        const cols = await client.execute(
          `SELECT name, type, CASE WHEN pk THEN 'PK' ELSE '' END as pk FROM pragma_table_info('${escaped}')`,
        );
        const fks = await client.execute(
          `SELECT "from", "table" as ref_table, "to" as ref_col FROM pragma_foreign_key_list('${escaped}')`,
        );

        logger.log(`  ${tbl}`);
        for (const col of cols.rows) {
          const name = String(col[0]);
          const type = String(col[1] || "");
          const pk = col[2] ? " [PK]" : "";
          const fk = fks.rows.find((f) => String(f[0]) === name);
          const fkLabel = fk ? ` → ${String(fk[1])}.${String(fk[2])}` : "";
          logger.log(`    ${name} ${type}${pk}${fkLabel}`);
        }
        logger.log();
      }
      return "handled";
    }

    case ".mode": {
      const newMode = parts[1]?.toLowerCase() as PrintMode | undefined;
      if (!newMode || !PRINT_MODES.includes(newMode)) {
        logger.log(`  Current mode: ${state.mode}`);
        logger.log(`  Available: ${PRINT_MODES.join(", ")}`);
      } else {
        state.mode = newMode;
        logger.log(`  Mode set to: ${state.mode}`);
      }
      return "handled";
    }

    case ".mask": {
      state.masked = true;
      logger.log("  Sensitive columns are now masked.");
      printMaskedPatterns(logger);
      return "handled";
    }

    case ".unmask": {
      state.masked = false;
      logger.log("  Sensitive columns are now visible.");
      printMaskedPatterns(logger);
      return "handled";
    }

    case ".timing": {
      state.timing = !state.timing;
      logger.log(`  Query timing ${state.timing ? "enabled" : "disabled"}.`);
      return "handled";
    }

    case ".size": {
      const tableName = parts[1];
      if (!tableName) {
        logger.error("Usage: .size TABLE");
        return "handled";
      }
      const escaped = tableName.replace(/'/g, "''");
      const schema = await client.execute(
        `SELECT sql FROM sqlite_master WHERE name='${escaped}' AND type='table'`,
      );
      if (!schema.rows[0]?.[0]) {
        logger.error(`Table not found: ${tableName}`);
        return "handled";
      }
      if (
        !(await confirmReadQuota(
          rl,
          "Row count requires a full table scan and counts against your read quota.",
          logger,
        ))
      )
        return "handled";

      const info = await client.execute(
        `SELECT COUNT(*) as row_count FROM "${tableName.replace(/"/g, '""')}"`,
      );
      const cols = await client.execute(
        `SELECT COUNT(*) as c FROM pragma_table_info('${escaped}')`,
      );
      const indexes = await client.execute(
        `SELECT COUNT(*) as c FROM sqlite_master WHERE type='index' AND tbl_name='${escaped}'`,
      );
      const rowCount = info.rows[0]?.[0] ?? 0;
      const colCount = cols.rows[0]?.[0] ?? 0;
      const indexCount = indexes.rows[0]?.[0] ?? 0;
      logger.log(`  Table:   ${tableName}`);
      logger.log(`  Rows:    ${rowCount}`);
      logger.log(`  Columns: ${colCount}`);
      logger.log(`  Indexes: ${indexCount}`);
      return "handled";
    }

    case ".read": {
      const filePath = parts[1];
      if (!filePath) {
        logger.error("Usage: .read FILE");
        return "handled";
      }
      // Lazy import to avoid circular dependency
      const { executeFile } = await import("./shell.ts");
      await executeFile(client, filePath, {
        mode: state.mode,
        masked: state.masked,
        timing: state.timing,
        logger,
      });
      return "handled";
    }

    case ".save": {
      if (!state.viewsDir) {
        logger.error(
          "Views require a database ID. Connect to a specific database to use views.",
        );
        return "handled";
      }
      const name = parts[1];
      if (!name) {
        logger.error("Usage: .save NAME");
        return "handled";
      }
      if (!isValidViewName(name)) {
        logger.error(
          "View name must be alphanumeric, hyphens, or underscores.",
        );
        return "handled";
      }
      if (!state.lastStatement) {
        logger.error("No query to save. Run a SQL statement first.");
        return "handled";
      }
      saveView(state.viewsDir, name, state.lastStatement);
      logger.success(`View "${name}" saved.`);
      return "handled";
    }

    case ".view": {
      if (!state.viewsDir) {
        logger.error(
          "Views require a database ID. Connect to a specific database to use views.",
        );
        return "handled";
      }
      const name = parts[1];
      if (!name) {
        logger.error("Usage: .view NAME");
        return "handled";
      }
      const sql = loadView(state.viewsDir, name);
      if (!sql) {
        logger.error(`View not found: ${name}`);
        return "handled";
      }
      logger.dim(`  ${sql}`);
      const { splitStatements } = await import("./parser.ts");
      const statements = splitStatements(sql);
      for (const stmt of statements) {
        try {
          const result = await client.execute(stmt);
          printResultSet(result, state.mode, state.masked, logger);
        } catch (err: any) {
          logger.error(err.message);
          return "handled";
        }
      }
      return "handled";
    }

    case ".views": {
      if (!state.viewsDir) {
        logger.error(
          "Views require a database ID. Connect to a specific database to use views.",
        );
        return "handled";
      }
      const views = listViews(state.viewsDir);
      if (views.length === 0) {
        logger.dim("  No saved views.");
      } else {
        for (const name of views) {
          const sql = loadView(state.viewsDir, name);
          const preview =
            sql && sql.length > 60 ? `${sql.slice(0, 60)}...` : sql;
          logger.log(`  ${name}  ${preview ? `— ${preview}` : ""}`);
        }
      }
      return "handled";
    }

    case ".unsave": {
      if (!state.viewsDir) {
        logger.error(
          "Views require a database ID. Connect to a specific database to use views.",
        );
        return "handled";
      }
      const name = parts[1];
      if (!name) {
        logger.error("Usage: .unsave NAME");
        return "handled";
      }
      if (deleteView(state.viewsDir, name)) {
        logger.success(`View "${name}" deleted.`);
      } else {
        logger.error(`View not found: ${name}`);
      }
      return "handled";
    }

    case ".clear-history": {
      saveHistory([]);
      // Clear the in-memory history so it doesn't get re-saved on close
      (rl as any).history.length = 0;
      logger.success("History cleared.");
      return "handled";
    }

    case ".help": {
      logger.log("  Schema");
      logger.log("    .tables           List all tables");
      logger.log("    .describe TABLE   Show column details for a table");
      logger.log("    .schema [TABLE]   Show CREATE statements");
      logger.log("    .indexes [TABLE]  List indexes");
      logger.log("    .fk TABLE         Show foreign keys for a table");
      logger.log("    .er               Show entity-relationship overview");
      logger.log();
      logger.log("  Data");
      logger.log("    .count TABLE      Count rows in a table");
      logger.log(
        "    .size TABLE       Show table stats (rows, columns, indexes)",
      );
      logger.log("    .truncate TABLE   Delete all rows from a table");
      logger.log("    .dump [TABLE]     Dump schema and data as SQL");
      logger.log("    .read FILE        Execute SQL statements from a file");
      logger.log();
      logger.log("  Views");
      logger.log("    .save NAME        Save the last query as a named view");
      logger.log("    .view NAME        Execute a saved view");
      logger.log("    .views            List all saved views");
      logger.log("    .unsave NAME      Delete a saved view");
      logger.log();
      logger.log("  Settings");
      logger.log(
        "    .mode [MODE]      Set output mode (default, table, json, csv, markdown)",
      );
      logger.log("    .timing           Toggle query execution timing");
      logger.log("    .mask             Enable sensitive column masking");
      logger.log("    .unmask           Disable sensitive column masking");
      printMaskedPatterns(logger, "      ");
      logger.log("    .clear-history    Clear command history");
      logger.log();
      logger.log("    .quit             Exit the shell");
      logger.log("    .help             Show this help");
      return "handled";
    }

    default:
      return "unknown";
  }
}
