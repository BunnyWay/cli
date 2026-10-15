import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  KeyRound,
  Link2,
  Maximize2,
} from "lucide-react";
import { useState } from "react";
import type { ColumnDefinition, Row, TableDefinition } from "@/api";
import { CellValue } from "@/components/CellValue";
import { toText } from "@/lib/format";
import { cn } from "@/lib/utils";

const NUMERIC = new Set(["INTEGER", "REAL"]);

export function DataGrid({
  table,
  columns,
  rows,
  offset,
  sort,
  onSort,
  selectedRow,
  onOpenRow,
  onFollowForeignKey,
  emptyMessage,
}: {
  table: TableDefinition;
  columns: ColumnDefinition[];
  rows: Row[];
  offset: number;
  sort?: { column: string; order: string };
  onSort: (column: string) => void;
  selectedRow: number | null;
  onOpenRow: (index: number, row: Row) => void;
  onFollowForeignKey: (
    column: string,
    value: unknown,
  ) => Promise<string | null>;
  emptyMessage: string;
}) {
  const foreignKeys = new Map(table.foreignKeys.map((fk) => [fk.column, fk]));
  const primaryKey = new Set(table.primaryKey);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 font-mono text-xs">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <th className="sticky left-0 z-10 w-12 border-b border-r bg-card" />
            {columns.map((col) => {
              const fk = foreignKeys.get(col.name);
              const sorted = sort?.column === col.name ? sort.order : null;
              return (
                <th
                  key={col.name}
                  aria-sort={
                    sorted === "asc"
                      ? "ascending"
                      : sorted === "desc"
                        ? "descending"
                        : undefined
                  }
                  className="border-b border-r p-0 text-left font-normal"
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.name)}
                    title={`Sort by ${col.name}`}
                    className="group flex h-9 w-full min-w-[140px] max-w-[360px] items-center gap-1.5 px-3 hover:bg-accent/50"
                  >
                    {primaryKey.has(col.name) && (
                      <KeyRound
                        className="h-3 w-3 shrink-0 text-primary"
                        aria-label="Primary key"
                      />
                    )}
                    {fk && (
                      <Link2
                        className="h-3 w-3 shrink-0 text-muted-foreground"
                        aria-label={`References ${fk.referencesTable}.${fk.referencesColumn}`}
                      />
                    )}
                    <span className="truncate font-medium text-foreground">
                      {col.name}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase text-muted-foreground/70">
                      {col.type}
                    </span>
                    <span className="ml-auto shrink-0">
                      {sorted === "asc" ? (
                        <ArrowUp className="h-3 w-3 text-foreground" />
                      ) : sorted === "desc" ? (
                        <ArrowDown className="h-3 w-3 text-foreground" />
                      ) : (
                        <ArrowUp className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/50" />
                      )}
                    </span>
                  </button>
                </th>
              );
            })}
            {/* Takes up spare width so data columns size to their content. */}
            <th className="w-full border-b" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no guaranteed identity (tables without a primary key); position in the result is the row
              key={offset + i}
              onClick={() => {
                // Let people select text in a cell without opening the row.
                if (window.getSelection()?.toString()) return;
                onOpenRow(i, row);
              }}
              className={cn(
                "group/row cursor-default",
                selectedRow === i ? "bg-accent" : "hover:bg-accent/40",
              )}
            >
              <td
                className={cn(
                  "sticky left-0 w-12 border-b border-r px-2 text-right tabular-nums text-muted-foreground/70",
                  selectedRow === i ? "bg-accent" : "bg-background",
                )}
              >
                <span className="group-hover/row:hidden">
                  {(offset + i + 1).toLocaleString()}
                </span>
                <Maximize2
                  className="ml-auto hidden h-3 w-3 text-foreground group-hover/row:block"
                  aria-label="Open row"
                />
              </td>
              {columns.map((col) => (
                <GridCell
                  key={col.name}
                  column={col}
                  value={row[col.name]}
                  foreignKey={foreignKeys.has(col.name)}
                  onFollow={() => onFollowForeignKey(col.name, row[col.name])}
                />
              ))}
              <td className="w-full border-b" />
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="p-10 text-center font-sans text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </div>
  );
}

function GridCell({
  column,
  value,
  foreignKey,
  onFollow,
}: {
  column: ColumnDefinition;
  value: unknown;
  foreignKey: boolean;
  onFollow: () => Promise<string | null>;
}) {
  const [copied, setCopied] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const hasValue = value !== null && value !== undefined;

  return (
    <td
      className={cn(
        "border-b border-r p-0",
        NUMERIC.has(column.type) && "text-right",
      )}
    >
      <div
        className="group/cell flex h-8 min-w-[140px] max-w-[360px] items-center gap-1 px-3"
        title={followError ?? undefined}
      >
        <div className="min-w-0 flex-1 truncate">
          <CellValue value={value} type={column.type} inline />
        </div>
        {hasValue && (
          <button
            type="button"
            title="Copy value"
            aria-label="Copy value"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(toText(value)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
            className="hidden shrink-0 rounded p-0.5 hover:bg-muted group-hover/cell:block"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        )}
        {foreignKey && hasValue && (
          <button
            type="button"
            title={followError ?? "Open referenced row"}
            aria-label="Open referenced row"
            onClick={async (e) => {
              e.stopPropagation();
              setFollowError(await onFollow());
            }}
            className={cn(
              "shrink-0 rounded p-0.5 hover:bg-muted",
              followError
                ? "text-destructive-foreground"
                : "text-muted-foreground",
            )}
          >
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </td>
  );
}
