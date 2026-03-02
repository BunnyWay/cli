import chalk from "chalk";
import Table from "cli-table3";
import type { ResultSet } from "@libsql/client";
import type { PrintMode, ShellLogger } from "./types.ts";

// ─── Sensitive column masking ────────────────────────────────────────

const SENSITIVE_SUBSTRINGS = [
  "password", "passwd", "secret", "_hash", "_token",
  "auth_token", "api_key", "apikey", "access_key",
  "private_key", "credit_card", "creditcard", "ssn",
];
const SENSITIVE_PREFIXES = ["encrypted_", "hashed_"];
const EMAIL_SUBSTRINGS = ["email", "e_mail"];
const MASK_STYLED = chalk.dim("••••••••");
const MASK_RAW = "********";

export type MaskType = "none" | "full" | "email";

/** Check if a column name refers to sensitive data. */
export function isSensitiveColumn(name: string): boolean {
  return columnMaskType(name) !== "none";
}

/** Determine the mask type for a column based on its name. */
export function columnMaskType(name: string): MaskType {
  const lower = name.toLowerCase();
  if (SENSITIVE_PREFIXES.some((p) => lower.startsWith(p))) return "full";
  if (SENSITIVE_SUBSTRINGS.some((s) => lower.includes(s))) return "full";
  if (EMAIL_SUBSTRINGS.some((s) => lower.includes(s))) return "email";
  return "none";
}

/** Mask an email address, preserving the first and last characters of the local part. */
export function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at < 1) return MASK_RAW;
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length === 1) return local[0] + "••••" + domain;
  return local[0] + "••••" + local[local.length - 1] + domain;
}

// ─── Value formatting ────────────────────────────────────────────────

/** Format a value for styled terminal output (NULL shown dimmed). */
export function formatValue(val: unknown): string {
  if (val === null) return chalk.dim("NULL");
  return String(val);
}

/** Format a value for raw output (no ANSI escapes). */
export function formatValueRaw(val: unknown): string {
  if (val === null) return "NULL";
  return String(val);
}

// ─── CSV escape ──────────────────────────────────────────────────────

/** Escape a value for CSV output (handles commas, quotes, newlines). */
export function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── Result set printing ─────────────────────────────────────────────

/** Print a result set in the given mode, optionally masking sensitive columns. */
export function printResultSet(
  result: ResultSet,
  mode: PrintMode,
  masked: boolean,
  logger: ShellLogger,
) {
  const masks = result.columns.map((c) =>
    masked ? columnMaskType(c) : ("none" as MaskType),
  );

  function applyMaskRaw(val: unknown, mask: MaskType): string {
    if (val === null) return formatValueRaw(val);
    if (mask === "full") return MASK_RAW;
    if (mask === "email") return maskEmail(String(val));
    return formatValueRaw(val);
  }

  function applyMask(val: unknown, mask: MaskType): string {
    if (val === null) return formatValue(val);
    if (mask === "full") return MASK_STYLED;
    if (mask === "email") return chalk.dim(maskEmail(String(val)));
    return formatValue(val);
  }

  if (mode === "json") {
    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < result.columns.length; i++) {
        const val = row[i];
        if (val === null || masks[i] === "none") {
          obj[result.columns[i]!] = val;
        } else {
          obj[result.columns[i]!] = applyMaskRaw(val, masks[i]!);
        }
      }
      return obj;
    });
    logger.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (result.columns.length === 0) {
    if (result.rowsAffected > 0) {
      logger.log(`Rows affected: ${result.rowsAffected}`);
    }
    return;
  }

  if (mode === "csv") {
    logger.log(result.columns.map(csvEscape).join(","));
    for (const row of result.rows) {
      logger.log(
        result.columns
          .map((_, i) => {
            if (masks[i] !== "none" && row[i] !== null)
              return csvEscape(applyMaskRaw(row[i], masks[i]!));
            return csvEscape(formatValueRaw(row[i]));
          })
          .join(","),
      );
    }
    return;
  }

  if (mode === "markdown") {
    const mdEscape = (v: string) => v.replace(/\|/g, "\\|");
    logger.log(`| ${result.columns.map(mdEscape).join(" | ")} |`);
    logger.log(`| ${result.columns.map(() => "---").join(" | ")} |`);
    for (const row of result.rows) {
      const cells = result.columns.map((_, i) => {
        if (masks[i] !== "none" && row[i] !== null)
          return mdEscape(applyMaskRaw(row[i], masks[i]!));
        return mdEscape(formatValueRaw(row[i]));
      });
      logger.log(`| ${cells.join(" | ")} |`);
    }
    return;
  }

  if (mode === "table") {
    const noColorStyle = chalk.level === 0 ? { head: [], border: [] } : {};
    const table = new Table({ head: result.columns, style: noColorStyle });
    for (const row of result.rows) {
      table.push(result.columns.map((_, i) => applyMask(row[i], masks[i]!)));
    }
    logger.log(table.toString());
    return;
  }

  // default: borderless aligned columns
  const table = new Table({
    head: result.columns.map((c) => chalk.bold(c)),
    chars: {
      top: "",
      "top-mid": "",
      "top-left": "",
      "top-right": "",
      bottom: "",
      "bottom-mid": "",
      "bottom-left": "",
      "bottom-right": "",
      left: "",
      "left-mid": "",
      mid: "",
      "mid-mid": "",
      right: "",
      "right-mid": "",
      middle: "  ",
    },
    style: { head: [], border: [], "padding-left": 0, "padding-right": 0 },
  });
  for (const row of result.rows) {
    table.push(result.columns.map((_, i) => applyMask(row[i], masks[i]!)));
  }
  logger.log(table.toString());
}
