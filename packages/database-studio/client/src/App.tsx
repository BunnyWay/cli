import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSchema, type StudioSchema } from "@/api";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Overview } from "@/components/Overview";
import { type ConsoleRequest, SqlConsole } from "@/components/SqlConsole";
import { TabBar } from "@/components/TabBar";
import { TableView } from "@/components/TableView";
import {
  SQL_TAB,
  setUrlParams,
  TABLE_VIEW_PARAMS,
  useUrlParam,
} from "@/hooks/use-url-state";
import type { FilterCondition } from "@/lib/filters";
import { quoteIdent } from "@/lib/sql";

export type OpenTable = (name: string, filters?: FilterCondition[]) => void;

type ViewState = Record<keyof typeof TABLE_VIEW_PARAMS, string | null>;

function currentViewState(): ViewState {
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(
    Object.keys(TABLE_VIEW_PARAMS).map((k) => [k, params.get(k)]),
  ) as ViewState;
}

export function App() {
  const [schema, setSchema] = useState<StudioSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [consoleRequest, setConsoleRequest] = useState<ConsoleRequest | null>(
    null,
  );
  const activeName = useUrlParam("table");
  const isSql = activeName === SQL_TAB;
  // Once opened, the console stays mounted so its editor and results survive tab switches.
  const [consoleMounted, setConsoleMounted] = useState(isSql);
  useEffect(() => {
    if (isSql) setConsoleMounted(true);
  }, [isSql]);
  const openParam = useUrlParam("open");
  // Each tab keeps its filters, sort, and page while another tab is active.
  const tabState = useRef(new Map<string, ViewState>());

  useEffect(() => {
    fetchSchema()
      .then(setSchema)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const known = new Set(schema?.tables.map((t) => t.name));
  const openTabs = (openParam?.split(",") ?? []).filter((n) => known.has(n));
  if (activeName && known.has(activeName) && !openTabs.includes(activeName)) {
    openTabs.push(activeName);
  }
  const openKey = openTabs.join(",");

  const switchTo = useCallback(
    (
      name: string | null,
      opts: { filters?: FilterCondition[]; tabs?: string[] } = {},
    ) => {
      const current = new URLSearchParams(window.location.search).get("table");
      if (current && current !== SQL_TAB) {
        tabState.current.set(current, currentViewState());
      }

      const tabs = opts.tabs ?? openKey.split(",").filter(Boolean);
      if (name && name !== SQL_TAB && !tabs.includes(name)) tabs.push(name);

      const view: Record<string, string | null> = opts.filters
        ? {
            ...TABLE_VIEW_PARAMS,
            filters: opts.filters.length ? JSON.stringify(opts.filters) : null,
          }
        : ((name ? tabState.current.get(name) : undefined) ??
          TABLE_VIEW_PARAMS);

      setUrlParams(
        { open: tabs.length ? tabs.join(",") : null, table: name, ...view },
        { push: true },
      );
      setPickerOpen(false);
    },
    [openKey],
  );

  const openTable = useCallback<OpenTable>(
    (name, filters) => switchTo(name, { filters }),
    [switchTo],
  );

  function openView(name: string) {
    setConsoleRequest({
      sql: `SELECT * FROM ${quoteIdent(name)} LIMIT 100;`,
      nonce: Date.now(),
    });
    switchTo(SQL_TAB);
  }

  function closeTab(name: string) {
    tabState.current.delete(name);
    const tabs = openTabs.filter((t) => t !== name);
    if (name !== activeName) {
      setUrlParams({ open: tabs.length ? tabs.join(",") : null });
      return;
    }
    const index = openTabs.indexOf(name);
    const next = tabs[Math.min(index, tabs.length - 1)] ?? null;
    // The closed tab's state must not be saved on the way out.
    setUrlParams({ table: null });
    switchTo(next, { tabs });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPickerOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (schema) {
      document.title = isSql
        ? "SQL · Database Studio"
        : activeName
          ? `${activeName} · Database Studio`
          : "Database Studio";
    }
  }, [schema, activeName, isSql]);

  if (!schema) {
    return <LoadingScreen error={error} />;
  }

  const active = schema.tables.find((t) => t.name === activeName) ?? null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TabBar
        schema={schema}
        openTabs={openTabs}
        activeTab={isSql ? SQL_TAB : (active?.name ?? null)}
        pickerOpen={pickerOpen}
        onPickerOpenChange={setPickerOpen}
        onSelect={(name) => switchTo(name)}
        onSelectView={openView}
        onClose={closeTab}
        onHome={() => switchTo(null)}
        onOpenSql={() => switchTo(SQL_TAB)}
      />
      <main className="flex min-h-0 flex-1 flex-col">
        {consoleMounted && (
          <div className={isSql ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <SqlConsole schema={schema} request={consoleRequest} />
          </div>
        )}
        {isSql ? null : active ? (
          <TableView
            key={active.name}
            table={active}
            tables={schema.tables}
            ddl={schema.ddl[active.name] ?? []}
            onOpenTable={openTable}
          />
        ) : (
          <Overview
            schema={schema}
            missing={activeName}
            onSelect={(name, view) => {
              switchTo(name);
              if (view) setUrlParams({ view });
            }}
            onSelectView={openView}
            onOpenSql={() => switchTo(SQL_TAB)}
          />
        )}
      </main>
    </div>
  );
}
