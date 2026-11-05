export function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function parseJsonObject(value: unknown): object | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[[{]/.test(trimmed)) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// BLOBs arrive base64-encoded.
export function base64Size(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function csvField(value: unknown): string {
  const text = toText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Rows are positional so repeated column names keep their own values.
function toCsv(columns: string[], rows: unknown[][]): string {
  const lines = [columns.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvField).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadRows(
  name: string,
  columns: string[],
  rows: unknown[][],
  format: "csv" | "json",
) {
  if (format === "csv") {
    download(`${name}.csv`, toCsv(columns, rows), "text/csv");
    return;
  }
  const objects = rows.map((r) =>
    Object.fromEntries(columns.map((c, i) => [c, r[i]])),
  );
  download(
    `${name}.json`,
    `${JSON.stringify(objects, null, 2)}\n`,
    "application/json",
  );
}
