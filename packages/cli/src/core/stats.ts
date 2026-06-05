import chalk from "chalk";
import { bunny } from "./colors.ts";

export const BAR_WIDTH = 24;

/** Sum the values of a date-keyed chart map. */
export function sumChart(
  chart: { [key: string]: number } | null | undefined,
): number {
  return Object.values(chart ?? {}).reduce((acc, n) => acc + n, 0);
}

/** Format a UTC chart-bucket timestamp as "Feb 3, 2026" (daily) or "Feb 3, 2026 14:00" (hourly); raw value if unparseable. */
export function formatBucketLabel(bucket: string, hourly = false): string {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;

  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (!hourly) return day;

  const time = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${day} ${time}`;
}

/** Render a horizontal bar chart from a list of [label, value] pairs. */
export function renderBarChart(rows: [string, number][]): string {
  const max = Math.max(...rows.map(([, n]) => n), 1);
  const labelWidth = Math.max(...rows.map(([l]) => l.length));
  const numWidth = Math.max(...rows.map(([, n]) => n.toLocaleString().length));
  return rows
    .map(([label, value]) => {
      const filled =
        value > 0 ? Math.max(1, Math.round((value / max) * BAR_WIDTH)) : 0;
      const bar =
        bunny("█".repeat(filled)) + chalk.gray("░".repeat(BAR_WIDTH - filled));
      const name = label.padEnd(labelWidth);
      const num = value.toLocaleString().padStart(numWidth);
      return `  ${name}  ${bar}  ${num}`;
    })
    .join("\n");
}
