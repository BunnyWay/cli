import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  KeyRound,
  Link2,
  Maximize2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CellValue } from "@/components/CellValue";
import { toText } from "@/lib/format";
import { startDrag, useCopy } from "@/lib/interaction";
import { cn } from "@/lib/utils";

const NUMERIC = new Set(["INTEGER", "REAL"]);
const MIN_WIDTH = 60;

export interface GridColumn {
  name: string;
  /** Declared type; unknown for query results. */
  type?: string;
  primaryKey?: boolean;
  /** `table.column` this column references, for the header icon and following the key. */
  references?: string;
}

interface Cell {
  row: number;
  col: number;
}

/**
 * The spreadsheet-style grid behind table browsing and query results. Click a
 * cell to select it, move with the arrow keys, copy with Cmd/Ctrl+C, and open
 * the row with Enter, a double-click, or the row number. Drag a header's edge
 * to resize a column; double-click the edge to reset it.
 */
export function DataGrid({
  columns,
  rows,
  offset = 0,
  sort,
  onSort,
  activeRow = null,
  onOpenRow,
  onFollowForeignKey,
  emptyMessage,
}: {
  columns: GridColumn[];
  /** Positional rows: `rows[i][j]` is column `j`. */
  rows: unknown[][];
  offset?: number;
  sort?: { column: string; order: string };
  onSort?: (column: string) => void;
  /** The row whose details are open, highlighted. */
  activeRow?: number | null;
  onOpenRow?: (index: number) => void;
  onFollowForeignKey?: (col: number, value: unknown) => Promise<string | null>;
  emptyMessage: string;
}) {
  const [selected, setSelected] = useState<Cell | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const { copied, copy } = useCopy(900);
  const [followErrors, setFollowErrors] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // A new page or result starts without a selection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the rows change
  useEffect(() => setSelected(null), [rows]);

  useEffect(() => {
    if (!selected) return;
    containerRef.current
      ?.querySelector(`[data-cell="${selected.row}:${selected.col}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  const widthStyle = (name: string): React.CSSProperties | undefined => {
    const w = widths[name];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  };

  const copyCell = (cell: Cell) =>
    copy(`${cell.row}:${cell.col}`, toText(rows[cell.row]?.[cell.col]));

  function onKeyDown(e: React.KeyboardEvent) {
    if (!selected || rows.length === 0) return;
    const move = (row: number, col: number) => {
      e.preventDefault();
      setSelected({
        row: Math.max(0, Math.min(rows.length - 1, row)),
        col: Math.max(0, Math.min(columns.length - 1, col)),
      });
    };
    switch (e.key) {
      case "ArrowUp":
        return move(selected.row - 1, selected.col);
      case "ArrowDown":
        return move(selected.row + 1, selected.col);
      case "ArrowLeft":
        return move(selected.row, selected.col - 1);
      case "ArrowRight":
        return move(selected.row, selected.col + 1);
      case "Home":
        return move(selected.row, 0);
      case "End":
        return move(selected.row, columns.length - 1);
      case "Enter":
        e.preventDefault();
        onOpenRow?.(selected.row);
        return;
      case "Escape":
        setSelected(null);
        return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      // Leave a real text selection to the browser's own copy.
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      copyCell(selected);
    }
  }

  function startResize(e: React.PointerEvent, name: string) {
    const th = (e.currentTarget as HTMLElement).closest("th");
    if (!th) return;
    const startWidth = th.getBoundingClientRect().width;
    startDrag(e, (dx) =>
      setWidths((w) => ({
        ...w,
        [name]: Math.max(MIN_WIDTH, Math.round(startWidth + dx)),
      })),
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the key handler is the grid's keyboard model
    <div
      ref={containerRef}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the grid takes focus so arrow keys move the cell selection
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto outline-none"
    >
      <table className="w-max min-w-full border-separate border-spacing-0 font-mono text-xs">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <th className="sticky left-0 z-10 w-12 border-b border-r bg-card" />
            {columns.map((col, j) => {
              const sorted = sort?.column === col.name ? sort.order : null;
              return (
                <th
                  // biome-ignore lint/suspicious/noArrayIndexKey: query results can repeat a column name
                  key={j}
                  aria-sort={
                    sorted === "asc"
                      ? "ascending"
                      : sorted === "desc"
                        ? "descending"
                        : undefined
                  }
                  className="relative border-b border-r p-0 text-left font-normal"
                >
                  <button
                    type="button"
                    disabled={!onSort}
                    onClick={() => onSort?.(col.name)}
                    title={onSort ? `Sort by ${col.name}` : col.name}
                    style={widthStyle(col.name)}
                    className={cn(
                      "group flex h-9 w-full items-center gap-1.5 px-3 disabled:cursor-default",
                      !widths[col.name] && "min-w-[140px] max-w-[360px]",
                      onSort && "hover:bg-accent/50",
                    )}
                  >
                    {col.primaryKey && (
                      <KeyRound
                        className="h-3 w-3 shrink-0 text-primary"
                        aria-label="Primary key"
                      />
                    )}
                    {col.references && (
                      <Link2
                        className="h-3 w-3 shrink-0 text-muted-foreground"
                        aria-label={`References ${col.references}`}
                      />
                    )}
                    <span className="truncate font-medium text-foreground">
                      {col.name}
                    </span>
                    {col.type && (
                      <span className="shrink-0 text-[10px] uppercase text-muted-foreground/70">
                        {col.type}
                      </span>
                    )}
                    {onSort && (
                      <span className="ml-auto shrink-0">
                        {sorted === "asc" ? (
                          <ArrowUp className="h-3 w-3 text-foreground" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="h-3 w-3 text-foreground" />
                        ) : (
                          <ArrowUp className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/50" />
                        )}
                      </span>
                    )}
                  </button>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only affordance; columns stay readable without resizing */}
                  <div
                    onPointerDown={(e) => startResize(e, col.name)}
                    onDoubleClick={() =>
                      setWidths(({ [col.name]: _, ...rest }) => rest)
                    }
                    title="Drag to resize, double-click to reset"
                    className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-primary/40"
                  />
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
              className={cn(
                "group/row",
                activeRow === i ? "bg-accent" : "hover:bg-accent/30",
              )}
            >
              <td
                className={cn(
                  "sticky left-0 w-12 border-b border-r p-0 text-right tabular-nums text-muted-foreground/70",
                  activeRow === i ? "bg-accent" : "bg-background",
                )}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={!onOpenRow}
                  onClick={() => onOpenRow?.(i)}
                  aria-label={`Open row ${offset + i + 1}`}
                  className="flex h-8 w-full items-center justify-end px-2 enabled:cursor-pointer"
                >
                  <span className={cn(onOpenRow && "group-hover/row:hidden")}>
                    {(offset + i + 1).toLocaleString()}
                  </span>
                  {onOpenRow && (
                    <Maximize2 className="hidden h-3 w-3 text-foreground group-hover/row:block" />
                  )}
                </button>
              </td>
              {columns.map((col, j) => {
                const value = row[j];
                const key = `${i}:${j}`;
                const isSelected = selected?.row === i && selected.col === j;
                const hasValue = value !== null && value !== undefined;
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: arrow keys on the focused grid move the selection
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: query results can repeat a column name
                    key={j}
                    data-cell={key}
                    onClick={() => setSelected({ row: i, col: j })}
                    onDoubleClick={() => onOpenRow?.(i)}
                    className={cn(
                      "cursor-default border-b border-r p-0",
                      col.type && NUMERIC.has(col.type) && "text-right",
                    )}
                  >
                    <div
                      style={widthStyle(col.name)}
                      title={followErrors[key]}
                      className={cn(
                        "flex h-8 items-center gap-1 px-3",
                        !widths[col.name] && "min-w-[140px] max-w-[360px]",
                        isSelected &&
                          "outline outline-2 -outline-offset-2 outline-primary",
                        copied === key && "bg-primary/20",
                      )}
                    >
                      <div className="min-w-0 flex-1 truncate">
                        <CellValue value={value} type={col.type ?? ""} inline />
                      </div>
                      {col.references && hasValue && onFollowForeignKey && (
                        <button
                          type="button"
                          title={
                            followErrors[key] ?? `Open ${col.references} row`
                          }
                          aria-label="Open referenced row"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const err = await onFollowForeignKey(j, value);
                            setFollowErrors(({ [key]: _, ...rest }) =>
                              err ? { ...rest, [key]: err } : rest,
                            );
                          }}
                          className={cn(
                            "shrink-0 rounded p-0.5 hover:bg-muted",
                            followErrors[key]
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
              })}
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
