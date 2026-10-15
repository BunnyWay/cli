import { useCallback, useEffect, useState } from "react";
import { fetchSchema, type StudioSchema } from "@/api";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Overview } from "@/components/Overview";
import { Sidebar } from "@/components/Sidebar";
import { TableView } from "@/components/TableView";
import {
  setUrlParams,
  TABLE_VIEW_PARAMS,
  useUrlParam,
} from "@/hooks/use-url-state";
import type { FilterCondition } from "@/lib/filters";

export type OpenTable = (name: string, filters?: FilterCondition[]) => void;

export function App() {
  const [schema, setSchema] = useState<StudioSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeName = useUrlParam("table");

  useEffect(() => {
    fetchSchema()
      .then(setSchema)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const openTable = useCallback<OpenTable>((name, filters) => {
    setUrlParams(
      {
        table: name,
        ...TABLE_VIEW_PARAMS,
        filters: filters?.length ? JSON.stringify(filters) : null,
      },
      { push: true },
    );
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
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        schema={schema}
        activeTable={active?.name ?? null}
        onSelect={(name) => openTable(name)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
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
            onSelect={(name) => openTable(name)}
          />
        )}
      </main>
    </div>
  );
}
