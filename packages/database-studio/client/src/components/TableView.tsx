import { Columns3, Download, Filter, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OpenTable } from "@/App";
import { fetchRowWhere, type RowsQuery, type TableDefinition } from "@/api";
import { DataGrid, type GridColumn } from "@/components/DataGrid";
import { FilterBar } from "@/components/FilterBar";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, Pager } from "@/components/Pager";
import { MenuItem, Popover } from "@/components/Popover";
import { RowSheet, type SheetEntry } from "@/components/RowSheet";
import { SchemaTab } from "@/components/SchemaTab";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useTableRows } from "@/hooks/use-table-rows";
import { setUrlParams, useUrlParam } from "@/hooks/use-url-state";
import {
  type FilterCondition,
  type FilterMode,
  isComplete,
  isOperator,
} from "@/lib/filters";
import { downloadRows } from "@/lib/format";
import { cn } from "@/lib/utils";

function parseFilters(
  raw: string | null,
  columns: Set<string>,
): FilterCondition[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): FilterCondition[] => {
    const { column, operator, value } = (entry ?? {}) as Record<
      string,
      unknown
    >;
    if (typeof column !== "string" || !columns.has(column)) return [];
    if (!isOperator(operator)) return [];
    return [
      { column, operator, value: typeof value === "string" ? value : "" },
    ];
  });
}

export function TableView({
  table,
  tables,
  ddl,
  onOpenTable,
}: {
  table: TableDefinition;
  tables: TableDefinition[];
  ddl: string[];
  onOpenTable: OpenTable;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetEntry[]>([]);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  const viewParam = useUrlParam("view");
  const pageParam = useUrlParam("page");
  const limitParam = useUrlParam("limit");
  const sortParam = useUrlParam("sort");
  const orderParam = useUrlParam("order");
  const filtersParam = useUrlParam("filters");
  const modeParam = useUrlParam("mode");

  const view = viewParam === "schema" ? "schema" : "data";
  const columnNames = new Set(table.columns.map((c) => c.name));
  const filters = parseFilters(filtersParam, columnNames);
  const mode: FilterMode = modeParam === "or" ? "or" : "and";
  const [filtersOpen, setFiltersOpen] = useState(filters.length > 0);

  const limit = PAGE_SIZES.includes(Number(limitParam))
    ? Number(limitParam)
    : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, Math.floor(Number(pageParam)) || 1);
  const sort: RowsQuery["sort"] =
    sortParam && columnNames.has(sortParam)
      ? { column: sortParam, order: orderParam === "desc" ? "desc" : "asc" }
      : undefined;

  const { data, loading, error, refresh } = useTableRows(table.name, {
    page,
    limit,
    filters,
    mode,
    sort,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page clears the highlighted row
  useEffect(() => setSelectedRow(null), [data]);

  // A page past the end (a stale link, or rows deleted elsewhere) snaps back to the last one.
  useEffect(() => {
    if (data && data.totalRows > 0 && page > data.totalPages) {
      setUrlParams({ page: String(data.totalPages) });
    }
  }, [data, page]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          "input, textarea, select, [contenteditable], [role=dialog]",
        )
      ) {
        return;
      }
      if (e.key === "r" && !e.metaKey && !e.ctrlKey && !e.altKey) refresh();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [refresh]);

  function setPage(p: number) {
    setUrlParams({ page: p <= 1 ? null : String(p) });
  }

  function setSort(column: string) {
    if (sort?.column !== column) {
      setUrlParams({ sort: column, order: null, page: null });
    } else if (sort.order === "asc") {
      setUrlParams({ order: "desc", page: null });
    } else {
      setUrlParams({ sort: null, order: null, page: null });
    }
  }

  function applyFilters(next: FilterCondition[], nextMode: FilterMode) {
    const ready = next.filter(isComplete);
    setUrlParams({
      filters: ready.length > 0 ? JSON.stringify(ready) : null,
      mode: ready.length > 1 && nextMode === "or" ? "or" : null,
      page: null,
    });
  }

  const openTable: OpenTable = (name, nextFilters) => {
    setSheet([]);
    if (nextFilters?.length) setFiltersOpen(true);
    onOpenTable(name, nextFilters);
  };

  async function followForeignKey(
    from: TableDefinition,
    column: string,
    value: unknown,
  ): Promise<string | null> {
    const fk = from.foreignKeys.find((f) => f.column === column);
    const target = fk && tables.find((t) => t.name === fk.referencesTable);
    if (!fk || !target) return "The referenced table isn't available.";
    try {
      const row = await fetchRowWhere(target.name, fk.referencesColumn, value);
      if (!row) {
        return `No row in ${target.name} where ${fk.referencesColumn} = ${String(value)}.`;
      }
      setSheet((s) => [...s, { table: target, row }]);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  const visibleColumns = useMemo(
    () => table.columns.filter((c) => !hidden.has(c.name)),
    [table, hidden],
  );
  const gridColumns: GridColumn[] = visibleColumns.map((c) => {
    const fk = table.foreignKeys.find((f) => f.column === c.name);
    return {
      name: c.name,
      type: c.type,
      primaryKey: table.primaryKey.includes(c.name),
      references: fk && `${fk.referencesTable}.${fk.referencesColumn}`,
    };
  });
  // Stable rows matter: DataGrid clears its cell selection when they change.
  const gridRows = useMemo(
    () => data?.rows.map((r) => visibleColumns.map((c) => r[c.name])) ?? [],
    [data, visibleColumns],
  );

  function exportPage(format: "csv" | "json") {
    downloadRows(
      `${table.name}-page-${page}`,
      visibleColumns.map((c) => c.name),
      gridRows,
      format,
    );
    setExportOpen(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <div className="flex rounded-md border p-0.5">
          {(["data", "schema"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() =>
                setUrlParams({ view: v === "data" ? null : v }, { push: true })
              }
              className={cn(
                "rounded px-2 py-0.5 text-xs capitalize",
                view === v
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>

        {view === "data" && (
          <>
            <Button
              variant={filtersOpen ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <Filter className="h-3 w-3" />
              Filter
              {filters.length > 0 && (
                <span className="rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                  {filters.length}
                </span>
              )}
            </Button>

            <div className="relative">
              <Button
                variant={columnsOpen ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setColumnsOpen(!columnsOpen)}
              >
                <Columns3 className="h-3 w-3" />
                Columns
                {hidden.size > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {table.columns.length - hidden.size}/{table.columns.length}
                  </span>
                )}
              </Button>
              <Popover
                open={columnsOpen}
                onClose={() => setColumnsOpen(false)}
                className="w-56"
              >
                <div className="max-h-72 overflow-y-auto">
                  {table.columns.map((col) => (
                    <MenuItem
                      key={col.name}
                      onClick={() => {
                        const next = new Set(hidden);
                        if (next.has(col.name)) next.delete(col.name);
                        else next.add(col.name);
                        setHidden(next);
                      }}
                    >
                      <Checkbox
                        checked={!hidden.has(col.name)}
                        tabIndex={-1}
                        className="pointer-events-none size-3.5"
                      />
                      <span className="truncate font-mono">{col.name}</span>
                    </MenuItem>
                  ))}
                </div>
                {hidden.size > 0 && (
                  <div className="mt-1 border-t pt-1">
                    <MenuItem
                      onClick={() => setHidden(new Set())}
                      className="text-muted-foreground"
                    >
                      Show all columns
                    </MenuItem>
                  </div>
                )}
              </Popover>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={!data || data.rows.length === 0}
                  onClick={() => setExportOpen(!exportOpen)}
                >
                  <Download className="h-3 w-3" />
                  Export
                </Button>
                <Popover
                  open={exportOpen}
                  onClose={() => setExportOpen(false)}
                  align="right"
                  className="w-44"
                >
                  <MenuItem onClick={() => exportPage("csv")}>
                    This page as CSV
                  </MenuItem>
                  <MenuItem onClick={() => exportPage("json")}>
                    This page as JSON
                  </MenuItem>
                </Popover>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={loading}
                onClick={refresh}
                title="Refresh (R)"
                aria-label="Refresh"
              >
                <RefreshCw
                  className={cn("h-3 w-3", loading && "animate-spin")}
                />
              </Button>
            </div>
          </>
        )}
      </div>

      {view === "schema" ? (
        <SchemaTab
          table={table}
          tables={tables}
          ddl={ddl}
          onOpenTable={openTable}
        />
      ) : (
        <>
          {filtersOpen && (
            <FilterBar
              key={filtersParam ?? ""}
              columns={table.columns}
              applied={filters}
              mode={mode}
              onApply={applyFilters}
            />
          )}

          <div className="relative flex min-h-0 flex-1 flex-col">
            {loading && data && (
              <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-border">
                <div className="sweep-bar h-full w-1/3 bg-primary" />
              </div>
            )}
            {error ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <p className="text-sm font-medium text-destructive-foreground">
                  Couldn't load rows from {table.name}
                </p>
                <p className="max-w-lg font-mono text-xs text-muted-foreground">
                  {error}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={refresh}>
                    Retry
                  </Button>
                  {filters.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => applyFilters([], "and")}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>
            ) : data ? (
              <DataGrid
                columns={gridColumns}
                rows={gridRows}
                offset={(page - 1) * limit}
                sort={sort}
                onSort={setSort}
                activeRow={selectedRow}
                onOpenRow={(index) => {
                  const row = data.rows[index];
                  if (!row) return;
                  setSelectedRow(index);
                  setSheet([{ table, row }]);
                }}
                onFollowForeignKey={(col, value) => {
                  const column = gridColumns[col]?.name;
                  return column
                    ? followForeignKey(table, column, value)
                    : Promise.resolve(null);
                }}
                emptyMessage={
                  filters.length > 0
                    ? "No rows match these filters."
                    : "This table is empty."
                }
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Loading rows…
              </div>
            )}
          </div>

          <Pager
            data={data}
            page={page}
            limit={limit}
            onPage={setPage}
            onLimit={(n) =>
              setUrlParams({
                limit: n === DEFAULT_PAGE_SIZE ? null : String(n),
                page: null,
              })
            }
          />
        </>
      )}

      <RowSheet
        stack={sheet}
        tables={tables}
        onBack={() => setSheet((s) => s.slice(0, -1))}
        onClose={() => {
          setSheet([]);
          setSelectedRow(null);
        }}
        onFollowForeignKey={followForeignKey}
        onOpenTable={openTable}
      />
    </div>
  );
}
