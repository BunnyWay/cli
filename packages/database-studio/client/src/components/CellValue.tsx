import { base64Size, formatBytes, parseJsonObject } from "@/lib/format";

/**
 * Renders a value by its column type. `inline` is the one-line grid form;
 * otherwise long text wraps and JSON is pretty-printed.
 */
export function CellValue({
  value,
  type,
  inline = false,
}: {
  value: unknown;
  type: string;
  inline?: boolean;
}) {
  if (value === null || value === undefined) {
    return <span className="italic text-muted-foreground/60">NULL</span>;
  }
  if (type === "BLOB" && typeof value === "string") {
    return (
      <span className="text-muted-foreground">
        BLOB · {formatBytes(base64Size(value))}
      </span>
    );
  }
  if (typeof value === "boolean") {
    return <span className="text-primary">{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="tabular-nums">{String(value)}</span>;
  }
  if (value === "") {
    return <span className="italic text-muted-foreground/60">empty</span>;
  }

  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!inline) {
    const json = parseJsonObject(value);
    if (json) return <>{JSON.stringify(json, null, 2)}</>;
  }
  return <>{text}</>;
}
