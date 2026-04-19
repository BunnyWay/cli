import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Copy,
  Eye,
  Maximize2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={copy}
      className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  );
}

function TruncatedCell({
  children,
  rawValue,
  onExpand,
}: {
  children: React.ReactNode;
  rawValue?: string;
  onExpand?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setTruncated(el.scrollWidth > el.clientWidth);
  });

  return (
    <div className="flex items-center gap-1">
      <div ref={ref} className="min-w-0 flex-1 truncate">
        {children}
      </div>
      {rawValue != null && <CopyButton value={rawValue} />}
      {truncated && onExpand && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted"
        >
          <Maximize2 className="h-3 w-3 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;
  onInspectRow?: (row: TData) => void;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  sorting: externalSorting,
  onSortingChange: externalOnSortingChange,
  columnVisibility = {},
  onColumnVisibilityChange,
  onInspectRow,
}: DataTableProps<TData, TValue>) {
  const sorting = externalSorting ?? [];

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      externalOnSortingChange?.(next);
    },
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnVisibility) : updater;
      onColumnVisibilityChange?.(next);
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  });

  const colCount = columns.length + (onInspectRow ? 1 : 0);

  return (
    <Table style={{ minWidth: `${colCount * 150}px` }}>
      <TableHeader className="sticky top-0 z-10 bg-card">
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {onInspectRow && <TableHead className="w-8" />}
            {headerGroup.headers.map((header) => {
              const canSort = header.column.getCanSort();
              const sorted = header.column.getIsSorted();
              return (
                <TableHead
                  key={header.id}
                  className="border-r border-border/50 font-mono text-xs last:border-r-0"
                  onClick={
                    canSort
                      ? header.column.getToggleSortingHandler()
                      : undefined
                  }
                  style={{
                    minWidth: 150,
                    ...(canSort
                      ? { cursor: "pointer", userSelect: "none" }
                      : undefined),
                  }}
                >
                  {header.isPlaceholder ? null : (
                    <div className="flex items-center gap-1">
                      <span className="flex-1">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </span>
                      {canSort &&
                        (sorted === "asc" ? (
                          <ArrowUp className="ml-auto h-3 w-3 shrink-0 text-foreground" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="ml-auto h-3 w-3 shrink-0 text-foreground" />
                        ) : (
                          <ArrowUpDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50" />
                        ))}
                    </div>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className="group last:border-b">
              {onInspectRow && (
                <TableCell className="w-8 p-0 text-center">
                  <button
                    onClick={() => onInspectRow(row.original)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                  >
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </TableCell>
              )}
              {row.getVisibleCells().map((cell) => {
                const raw = cell.getValue();
                const rawStr =
                  raw === null || raw === undefined ? undefined : String(raw);
                return (
                  <TableCell
                    key={cell.id}
                    className="max-w-xs border-r border-border/50 font-mono text-xs last:border-r-0"
                  >
                    <TruncatedCell
                      rawValue={rawStr}
                      onExpand={
                        onInspectRow
                          ? () => onInspectRow(row.original)
                          : undefined
                      }
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TruncatedCell>
                  </TableCell>
                );
              })}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={columns.length + (onInspectRow ? 1 : 0)}
              className="h-24 text-center"
            >
              No results.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
