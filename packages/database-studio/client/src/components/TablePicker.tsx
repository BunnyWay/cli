import { Search, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TableDefinition } from "@/api";
import { cn } from "@/lib/utils";

/** Searchable table list with arrow-key navigation, shown in the tab bar's "+" popover. */
export function TablePicker({
  tables,
  openTabs,
  onSelect,
}: {
  tables: TableDefinition[];
  openTabs: string[];
  onSelect: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? tables.filter((t) => t.name.toLowerCase().includes(q)) : tables;
  }, [tables, search]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      const table = visible[highlight];
      if (table) onSelect(table.name);
    }
  }

  return (
    <div className="w-64">
      <div className="relative p-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Open a table…"
          aria-label="Search tables"
          // biome-ignore lint/a11y/noAutofocus: the picker exists to be typed into
          autoFocus
          className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
      <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
        {visible.map((table, i) => (
          <button
            key={table.name}
            type="button"
            data-index={i}
            onClick={() => onSelect(table.name)}
            onMouseMove={() => setHighlight(i)}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
              i === highlight
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <Table2 className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-mono">
              {table.name}
            </span>
            {openTabs.includes(table.name) ? (
              <span className="shrink-0 text-[10px] text-primary">open</span>
            ) : (
              <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/70">
                {table.columns.length} cols
              </span>
            )}
          </button>
        ))}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            {tables.length === 0
              ? "No tables yet"
              : `No tables match “${search}”`}
          </p>
        )}
      </div>
    </div>
  );
}
