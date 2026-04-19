import type { SortingState, VisibilityState } from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Filter,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type FilterCondition,
  type FilterMode,
  fetchTableRows,
  fetchTableSchema,
  type RowsResponse,
  type TableSchema,
} from "@/api.ts";
import { ColumnToggleMenu } from "@/components/ColumnToggleMenu";
import { DataTab } from "@/components/DataTab";
import { FilterBar, NULLARY_OPERATORS } from "@/components/FilterBar";
import { SchemaTab } from "@/components/SchemaTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setUrlParams, useUrlParam } from "@/hooks/use-url-state";

interface TableViewProps {
  tableName: string;
  onSelectTable: (name: string) => void;
}

export function TableView({ tableName, onSelectTable }: TableViewProps) {
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [data, setData] = useState<RowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"data" | "schema">("data");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  // Number of filter rows in the UI (may include empty/pending ones)
  const [filterRowCount, setFilterRowCount] = useState(0);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // Read state from URL
  const pageParam = useUrlParam("page");
  const limitParam = useUrlParam("limit");
  const filtersParam = useUrlParam("filters");
  const filterModeParam = useUrlParam("filterMode");
  const sortParam = useUrlParam("sort");
  const orderParam = useUrlParam("order");

  const filterMode: FilterMode = filterModeParam === "or" ? "or" : "and";

  const page = Math.max(1, Number(pageParam) || 1);
  const limit = Math.min(100, Math.max(1, Number(limitParam) || 50));

  const sortState: SortingState = useMemo(() => {
    if (!sortParam) return [];
    return [{ id: sortParam, desc: orderParam === "desc" }];
  }, [sortParam, orderParam]);

  const sort = useMemo(() => {
    if (!sortParam) return undefined;
    return {
      column: sortParam,
      order: (orderParam === "desc" ? "desc" : "asc") as "asc" | "desc",
    };
  }, [sortParam, orderParam]);

  const appliedFilters: FilterCondition[] = useMemo(() => {
    if (!filtersParam) return [];
    try {
      const parsed = JSON.parse(filtersParam);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [filtersParam]);

  // Sync filter row count from URL on table change
  useEffect(() => {
    setFilterRowCount(appliedFilters.length);
    if (appliedFilters.length > 0) setFiltersOpen(true);
  }, [appliedFilters.length]);

  useEffect(() => {
    setTab("data");
    setColumnVisibility({});
    setColumnsOpen(false);
    setLoading(true);
    setError(null);
    setSchema(null);
    setData(null);
    Promise.all([
      fetchTableSchema(tableName),
      fetchTableRows(tableName, 1, limit, [], sort, filterMode),
    ])
      .then(([s, d]) => {
        setSchema(s);
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [tableName, limit, filterMode, sort]);

  useEffect(() => {
    setLoading(true);
    fetchTableRows(tableName, page, limit, appliedFilters, sort, filterMode)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [page, limit, tableName, filterMode, sort, appliedFilters]);

  function refresh() {
    setLoading(true);
    fetchTableRows(tableName, page, limit, appliedFilters, sort, filterMode)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  function setPage(p: number) {
    setUrlParams({ page: p === 1 ? null : String(p) });
  }

  function setLimit(l: number) {
    setUrlParams({ limit: l === 50 ? null : String(l), page: null });
  }

  function setSorting(next: SortingState) {
    if (next.length === 0) {
      setUrlParams({ sort: null, order: null, page: null });
    } else {
      setUrlParams({
        sort: next[0].id,
        order: next[0].desc ? "desc" : null,
        page: null,
      });
    }
  }

  function applyFiltersFromRefs(
    filterRefs: Map<
      number,
      { column: string; operator: string; valueRef: HTMLInputElement | null }
    >,
    mode?: FilterMode,
  ) {
    const filters: FilterCondition[] = [];
    for (const [, ref] of filterRefs) {
      const value = ref.valueRef?.value ?? "";
      if (ref.column && (NULLARY_OPERATORS.has(ref.operator) || value !== "")) {
        filters.push({ column: ref.column, operator: ref.operator, value });
      }
    }
    const m = mode ?? filterMode;
    setUrlParams({
      filters: filters.length > 0 ? JSON.stringify(filters) : null,
      filterMode: filters.length > 0 && m === "or" ? "or" : null,
      page: null,
    });
  }

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-medium text-destructive">
          Failed to load "{tableName}"
        </p>
        <p className="max-w-lg font-mono text-xs text-muted-foreground">
          {error}
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-4">
        <div className="flex gap-1">
          <Button
            variant={tab === "data" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs"
            onClick={() => setTab("data")}
          >
            Data
          </Button>
          <Button
            variant={tab === "schema" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs"
            onClick={() => setTab("schema")}
          >
            Schema
          </Button>
          {tab === "data" && (
            <>
              <Button
                variant={filtersOpen ? "secondary" : "ghost"}
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <Filter className="h-3 w-3" />
                Filter
                {appliedFilters.length > 0 && (
                  <Badge
                    variant="outline"
                    className="ml-0.5 h-4 min-w-4 px-1 text-[10px]"
                  >
                    {appliedFilters.length}
                  </Badge>
                )}
              </Button>
              <div className="relative">
                <Button
                  variant={columnsOpen ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={() => setColumnsOpen(!columnsOpen)}
                >
                  <Columns3 className="h-3 w-3" />
                  Columns
                  {Object.values(columnVisibility).some((v) => !v) && (
                    <Badge
                      variant="outline"
                      className="ml-0.5 h-4 min-w-4 px-1 text-[10px]"
                    >
                      {Object.values(columnVisibility).filter((v) => !v).length}
                    </Badge>
                  )}
                </Button>
                {columnsOpen && schema && (
                  <ColumnToggleMenu
                    columns={schema.columns.map((c) => c.name)}
                    visibility={columnVisibility}
                    onChange={setColumnVisibility}
                    onClose={() => setColumnsOpen(false)}
                  />
                )}
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {tab === "data" && data && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={loading}
                onClick={refresh}
              >
                <RefreshCw
                  className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
                />
              </Button>

              {data.responseTime != null && (
                <span className="mr-2 text-[10px] tabular-nums text-muted-foreground">
                  {data.responseTime}ms
                </span>
              )}

              <Badge
                variant="outline"
                className="mr-2 font-mono text-[10px] tabular-nums"
              >
                {data.pagination.totalRows.toLocaleString()} rows
              </Badge>

              <label
                htmlFor="page-limit"
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                Limit
                <Input
                  id="page-limit"
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  onChange={(e) => {
                    const v = Math.min(
                      100,
                      Math.max(1, Number(e.target.value) || 1),
                    );
                    setLimit(v);
                  }}
                  className="h-6 w-14 px-1.5 text-center font-mono text-xs tabular-nums"
                />
              </label>

              <span className="mx-1 text-xs tabular-nums text-muted-foreground">
                {data.pagination.page} / {data.pagination.totalPages}
              </span>

              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={page <= 1 || loading}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={page >= data.pagination.totalPages || loading}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {error && data && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          Failed to refresh: <span className="font-mono">{error}</span>
        </div>
      )}

      {filtersOpen && tab === "data" && schema && (
        <FilterBar
          columns={schema.columns}
          appliedFilters={appliedFilters}
          filterRowCount={filterRowCount}
          onFilterRowCountChange={setFilterRowCount}
          filterMode={filterMode}
          onApply={applyFiltersFromRefs}
        />
      )}

      {tab === "data" ? (
        <DataTab
          data={data}
          schema={schema}
          sorting={sortState}
          onSortingChange={setSorting}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
        />
      ) : (
        <SchemaTab schema={schema} onSelectTable={onSelectTable} />
      )}
    </div>
  );
}
