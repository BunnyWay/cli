import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSchema, type StudioSchema } from "@/api";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Overview } from "@/components/Overview";
import { TabBar } from "@/components/TabBar";
import { TableView } from "@/components/TableView";
import {
  setUrlParams,
  TABLE_VIEW_PARAMS,
  useUrlParam,
} from "@/hooks/use-url-state";
import type { FilterCondition } from "@/lib/filters";

export type OpenTable = (name: string, filters?: FilterCondition[]) => void;

type ViewState = Record<keyof typeof TABLE_VIEW_PARAMS, string | null>;

/** The active tab's view params as they stand in the URL. */
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
  const activeName = useUrlParam("table");
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
      if (current) tabState.current.set(current, currentViewState());

      const tabs = opts.tabs ?? openKey.split(",").filter(Boolean);
      if (name && !tabs.includes(name)) tabs.push(name);

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

  function closeTab(name: string) {
    tabState.current.delete(name);
    const tabs = openTabs.filter((t) => t !== name);
    if (name !== activeName) {
      setUrlParams({ open: tabs.length ? tabs.join(",") : null });
      return;
    }
    // Closing the active tab moves to its neighbour, like a browser.
    const index = openTabs.indexOf(name);
    const next = tabs[Math.min(index, tabs.length - 1)] ?? null;
    // The closed tab's state must not be saved on the way out.
    setUrlParams({ table: null });
    switchTo(next, { tabs });
  }

  // Cmd/Ctrl+K opens the table picker from anywhere.
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
      document.title = activeName
        ? `${activeName} · Database Studio`
        : "Database Studio";
    }
  }, [schema, activeName]);

  if (!schema) {
    return <LoadingScreen error={error} />;
  }

  const active = schema.tables.find((t) => t.name === activeName) ?? null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TabBar
        schema={schema}
        openTabs={openTabs}
        activeTab={active?.name ?? null}
        pickerOpen={pickerOpen}
        onPickerOpenChange={setPickerOpen}
        onSelect={(name) => switchTo(name)}
        onClose={closeTab}
        onHome={() => switchTo(null)}
      />
      <main className="flex min-h-0 flex-1 flex-col">
        {active ? (
          <TableView
            key={active.name}
            table={active}
            tables={schema.tables}
            onOpenTable={openTable}
          />
        ) : (
          <Overview
            tables={schema.tables}
            missing={activeName}
            onSelect={(name) => switchTo(name)}
          />
        )}
      </main>
    </div>
  );
}
