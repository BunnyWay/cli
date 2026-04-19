import type {
  ColumnDef,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { fetchRowLookup, type RowsResponse, type TableSchema } from "@/api.ts";
import { FadeScrollArea } from "@/components/FadeScrollArea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type RowRecord = Record<string, unknown>;

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="italic text-muted-foreground">NULL</span>;
  }
  if (typeof value === "boolean") {
    return (
      <Badge variant="outline" className="text-[10px]">
        {String(value)}
      </Badge>
    );
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return <span className="tabular-nums">{String(value)}</span>;
  }
  const str = String(value);
  if (str.length > 200) {
    return <span title={str}>{str.slice(0, 200)}...</span>;
  }
  return <>{str}</>;
}

interface SheetEntry {
  id: string;
  tableName: string;
  row: Record<string, unknown>;
  columnTypes: Map<string, string>;
  foreignKeys: Map<string, { table: string; to: string }>;
}

export function DataTab({
  data,
  schema,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
}: {
  data: RowsResponse | null;
  schema: TableSchema | null;
  sorting: SortingState;
  onSortingChange: (s: SortingState) => void;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (v: VisibilityState) => void;
}) {
  const [sheetStack, setSheetStack] = useState<SheetEntry[]>([]);

  const columnTypes = useMemo(() => {
    if (!schema) return new Map<string, string>();
    return new Map(schema.columns.map((c) => [c.name, c.type || "ANY"]));
  }, [schema]);

  const primaryKeys = useMemo(() => {
    if (!schema) return new Set<string>();
    return new Set(
      schema.columns.filter((c) => c.primaryKey).map((c) => c.name),
    );
  }, [schema]);

  const foreignKeys = useMemo(() => {
    if (!schema) return new Map<string, { table: string; to: string }>();
    return new Map(
      schema.foreignKeys.map((fk) => [fk.from, { table: fk.table, to: fk.to }]),
    );
  }, [schema]);

  function openRow(
    row: RowRecord,
    tableName: string,
    types: Map<string, string>,
    fks: Map<string, { table: string; to: string }>,
  ) {
    setSheetStack((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        tableName,
        row,
        columnTypes: types,
        foreignKeys: fks,
      },
    ]);
  }

  function closeSheet(index: number) {
    setSheetStack((prev) => prev.slice(0, index));
  }

  const followFkRef =
    useRef<(fk: { table: string; to: string }, value: unknown) => void>();
  followFkRef.current = async (fk, value) => {
    if (value === null || value === undefined) return;
    try {
      const result = await fetchRowLookup(fk.table, fk.to, String(value));
      const types = new Map(
        result.schema.map((c) => [c.name, c.type || "ANY"]),
      );
      const fks = new Map(
        result.foreignKeys.map((f) => [f.from, { table: f.table, to: f.to }]),
      );
      openRow(result.row as RowRecord, fk.table, types, fks);
    } catch {
      // Row not found or error — ignore
    }
  };

  const followFk = useCallback(
    (fk: { table: string; to: string }, value: unknown) => {
      followFkRef.current?.(fk, value);
    },
    [],
  );

  const columns = useMemo<ColumnDef<RowRecord>[]>(() => {
    if (!data) return [];
    return data.columns.map((col) => {
      const fk = foreignKeys.get(col);
      const colType = columnTypes.get(col) ?? "ANY";
      const isPk = primaryKeys.has(col);
      return {
        accessorKey: col,
        header: () => (
          <div className="flex items-center gap-1.5">
            <span>{col}</span>
            {isPk && (
              <Badge
                variant="outline"
                className="font-mono text-[10px] font-normal"
              >
                PK
              </Badge>
            )}
            {fk && (
              <Badge
                variant="outline"
                className="font-mono text-[10px] font-normal"
              >
                FK
              </Badge>
            )}
            <Badge
              variant="secondary"
              className="font-mono text-[10px] font-normal"
            >
              {colType}
            </Badge>
          </div>
        ),
        cell: ({ getValue }) => {
          const value = getValue();
          if (fk && value !== null && value !== undefined) {
            return (
              <Button
                variant="link"
                onClick={() => followFk(fk, value)}
                className="h-auto p-0 text-muted-foreground underline-offset-4 hover:text-foreground hover:no-underline"
              >
                <CellValue value={value} />
              </Button>
            );
          }
          return <CellValue value={value} />;
        },
      };
    });
  }, [data?.columns, foreignKeys, columnTypes, primaryKeys, followFk, data]);

  if (!data) return null;

  return (
    <>
      <div className="flex-1 overflow-auto">
        <DataTable
          columns={columns}
          data={data.rows as RowRecord[]}
          sorting={sorting}
          onSortingChange={onSortingChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={onColumnVisibilityChange}
          onInspectRow={(row) => openRow(row, "", columnTypes, foreignKeys)}
        />
      </div>
      {sheetStack.map((entry, i) => (
        <Sheet
          key={entry.id}
          open
          modal={false}
          onOpenChange={(open) => {
            if (!open) closeSheet(i);
          }}
        >
          <SheetContent
            hideOverlay={i > 0}
            className="flex flex-col overflow-hidden p-0 sm:max-w-md transition-transform"
            style={{
              zIndex: 50 + i,
              transform: `translateX(-${(sheetStack.length - 1 - i) * 24}px)`,
            }}
            onInteractOutside={(e) => {
              if (i === sheetStack.length - 1) {
                closeSheet(i);
              } else {
                e.preventDefault();
              }
            }}
          >
            <SheetHeader className="shrink-0 px-6 pt-6">
              <SheetTitle className="font-mono text-sm">
                {entry.tableName ? `${entry.tableName}` : "Row Detail"}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Field values for the selected row
              </SheetDescription>
            </SheetHeader>
            <FadeScrollArea className="flex-1">
              <div className="space-y-3 px-6 pb-6 pt-4">
                {Object.entries(entry.row).map(([key, value]) => {
                  const fk = entry.foreignKeys.get(key);
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium">
                          {key}
                        </span>
                        {fk && (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px]"
                          >
                            FK → {fk.table}.{fk.to}
                          </Badge>
                        )}
                        <Badge
                          variant="secondary"
                          className="ml-auto font-mono text-[10px]"
                        >
                          {entry.columnTypes.get(key) ?? "ANY"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap">
                          <CellValue value={value} />
                        </div>
                        {fk && value !== null && value !== undefined && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => followFk(fk, value)}
                            className="size-auto shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={`View ${fk.table} record`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </FadeScrollArea>
          </SheetContent>
        </Sheet>
      ))}
    </>
  );
}
