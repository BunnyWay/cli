import chalk from "chalk";
import Table from "cli-table3";
import type { OutputFormat } from "./types.ts";

/** Resolve a date-like value to a `Date`, or `null` if invalid/missing. */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Format a date for display (e.g. "Feb 1, 2026"). Returns "—" for invalid/missing values. */
export function formatDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format a date with time for display (e.g. "Feb 28, 2026 15:04"). Returns "—" for invalid/missing values. */
export function formatDateTime(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return (
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }) +
    " " +
    d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  );
}

/** Escape a value for CSV output. */
export function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Escape pipe characters for markdown table cells. */
function mdEscape(value: string): string {
  return value.replace(/\|/g, "\\|");
}

/**
 * Render tabular data (headers + rows) in the specified format.
 *
 * Does not handle `json` — each command serialises its own JSON.
 */
export function formatTable(
  headers: string[],
  rows: string[][],
  format: OutputFormat,
): string {
  if (format === "csv") {
    const lines = [headers.map(csvEscape).join(",")];
    for (const row of rows) {
      lines.push(row.map((v) => csvEscape(v ?? "")).join(","));
    }
    return lines.join("\n");
  }

  if (format === "markdown") {
    const header = `| ${headers.map(mdEscape).join(" | ")} |`;
    const separator = `| ${headers.map(() => "---").join(" | ")} |`;
    const body = rows.map(
      (row) => `| ${row.map((v) => mdEscape(v ?? "")).join(" | ")} |`,
    );
    return [header, separator, ...body].join("\n");
  }

  // cli-table3 applies its own ANSI colors to headers and borders.
  // Disable those when NO_COLOR is set (chalk already handles itself).
  const noColorStyle = chalk.level === 0 ? { head: [], border: [] } : {};

  if (format === "table") {
    const table = new Table({ head: headers, style: noColorStyle });
    for (const row of rows) {
      table.push(row);
    }
    return table.toString();
  }

  // text: borderless aligned columns with bold headers
  const table = new Table({
    head: headers.map((h) => chalk.bold(h)),
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
    style: { "padding-left": 1, "padding-right": 0, ...noColorStyle },
  });
  for (const row of rows) {
    table.push(row);
  }
  return table.toString();
}

/**
 * Render key-value pairs in the specified format.
 *
 * Does not handle `json` — each command serialises its own JSON.
 */
export function formatKeyValue(
  entries: { key: string; value: string }[],
  format: OutputFormat,
): string {
  return formatTable(
    ["Key", "Value"],
    entries.map((e) => [e.key, e.value]),
    format,
  );
}

/** Render an ASCII progress bar with color coding (green/yellow/red). */
export function progressBar(fraction: number, width = 20): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  if (fraction > 0.9) return chalk.red(bar);
  if (fraction > 0.7) return chalk.yellow(bar);
  return chalk.green(bar);
}

/** Format a byte-like size string (e.g. "25600000") into human-readable. */
export function formatSize(sizeStr: string): string {
  const bytes = parseFloat(sizeStr);
  if (isNaN(bytes) || bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
