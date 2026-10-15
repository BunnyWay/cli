import { Lock, Search, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioSchema } from "@/api";
import { DatabaseIcon } from "@/components/DatabaseIcon";
import { cn } from "@/lib/utils";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function Sidebar({
  schema,
  activeTable,
  onSelect,
}: {
  schema: StudioSchema;
  activeTable: string | null;
  onSelect: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? schema.tables.filter((t) => t.name.toLowerCase().includes(q))
      : schema.tables;
  }, [schema.tables, search]);

  // Cmd/Ctrl+K jumps to the table search from anywhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      const table = visible[highlight];
      if (table) onSelect(table.name);
    } else if (e.key === "Escape") {
      setSearch("");
      inputRef.current?.blur();
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <DatabaseIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Database Studio</span>
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title="Studio only reads data. Nothing you do here changes the database."
          >
            <Lock className="h-2.5 w-2.5" />
            Read-only
          </span>
        </div>
        {schema.label && (
          <p
            className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
            title={schema.label}
          >
            {schema.label}
          </p>
        )}
      </div>

      <div className="p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search tables"
            aria-label="Search tables"
            className="h-8 w-full rounded-md border bg-background pl-7 pr-10 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </div>
      </div>

      <nav
        ref={listRef}
        aria-label="Tables"
        className="flex-1 overflow-y-auto px-2 pb-2"
      >
        {visible.map((table, i) => (
          <button
            key={table.name}
            type="button"
            data-index={i}
            onClick={() => onSelect(table.name)}
            onMouseMove={() => setHighlight(i)}
            aria-current={table.name === activeTable ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
              table.name === activeTable
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
              search && i === highlight && "ring-1 ring-ring/50",
            )}
          >
            <Table2
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                table.name === activeTable && "text-primary",
              )}
            />
            <span className="min-w-0 flex-1 truncate font-mono">
              {table.name}
            </span>
            <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
              {table.columns.length}
            </span>
          </button>
        ))}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {schema.tables.length === 0
              ? "No tables yet"
              : `No tables match “${search}”`}
          </p>
        )}
      </nav>

      <div className="border-t px-4 py-2 text-[10px] text-muted-foreground">
        {schema.tables.length} table{schema.tables.length === 1 ? "" : "s"}
      </div>
    </aside>
  );
}
