import { useEffect, useRef, useState } from "react";
import { LoadingScreen } from "@/components/LoadingScreen.tsx";
import { TableView } from "@/components/TableView.tsx";
import { type TableSummary, fetchTables } from "@/api.ts";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useUrlParam, setUrlParams } from "@/hooks/use-url-state";
import { Plus, X } from "lucide-react";

export function App() {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // URL state
  const openParam = useUrlParam("open");
  const activeTab = useUrlParam("tab");
  const openTabs = openParam ? openParam.split(",").filter(Boolean) : [];

  useEffect(() => {
    fetchTables()
      .then(setTables)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      setSearch("");
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  function openTable(name: string) {
    const next = openTabs.includes(name) ? openTabs : [...openTabs, name];
    setUrlParams({
      open: next.join(","),
      tab: name,
      filters: null,
      page: null,
    });
    setMenuOpen(false);
  }

  function closeTab(name: string) {
    const next = openTabs.filter((t) => t !== name);
    let newActive = activeTab;
    if (activeTab === name) {
      const idx = openTabs.indexOf(name);
      newActive = next[Math.min(idx, next.length - 1)] ?? null;
    }
    setUrlParams({
      open: next.length ? next.join(",") : null,
      tab: newActive,
      filters: null,
      page: null,
    });
  }

  function switchTab(name: string) {
    setUrlParams({
      tab: name,
      filters: null,
      page: null,
    });
  }

  if (loading || error) {
    return <LoadingScreen error={error} />;
  }

  const unopenedTables = tables.filter((t) => !openTabs.includes(t.name));

  const hasOpenTabs = openTabs.length > 0;

  return (
    <div className="flex h-screen flex-col">
      {hasOpenTabs && (
      <header className="flex h-10 shrink-0 items-center border-b bg-sidebar">
        <div className="flex h-full w-10 shrink-0 items-center justify-center border-r text-muted-foreground">
          <svg
            role="img"
            aria-hidden="true"
            focusable="false"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            className="h-4 w-4"
            fill="currentColor"
          >
            <path opacity="0.4" d="M0 80l0 48c0 44.2 100.3 80 224 80s224-35.8 224-80l0-48C448 35.8 347.7 0 224 0S0 35.8 0 80zM0 205.8L0 288c0 44.2 100.3 80 224 80s224-35.8 224-80l0-82.2c-14.8 9.8-31.8 17.7-49.5 24-47 16.8-108.7 26.2-174.5 26.2S96.4 246.5 49.5 229.8c-17.6-6.3-34.7-14.2-49.5-24zm0 160L0 432c0 44.2 100.3 80 224 80s224-35.8 224-80l0-66.2c-14.8 9.8-31.8 17.7-49.5 24-47 16.8-108.7 26.2-174.5 26.2S96.4 406.5 49.5 389.8c-17.6-6.3-34.7-14.2-49.5-24z" />
            <path d="M0 205.8L0 128c0 44.2 100.3 80 224 80s224-35.8 224-80l0 77.8c-14.8 9.8-31.8 17.7-49.5 24-47 16.8-108.7 26.2-174.5 26.2S96.4 246.5 49.5 229.8c-17.6-6.3-34.7-14.2-49.5-24zm0 160L0 288c0 44.2 100.3 80 224 80s224-35.8 224-80l0 77.8c-14.8 9.8-31.8 17.7-49.5 24-47 16.8-108.7 26.2-174.5 26.2S96.4 406.5 49.5 389.8c-17.6-6.3-34.7-14.2-49.5-24z" />
          </svg>
        </div>
        <nav className="flex h-full overflow-x-auto">
          {openTabs.map((name) => (
            <div
              key={name}
              className={cn(
                "group flex h-full shrink-0 items-center border-r text-sm",
                activeTab === name
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-background/50",
              )}
            >
              <button
                onClick={() => switchTab(name)}
                className="flex h-full items-center gap-1.5 pl-3 pr-1 font-mono text-xs"
              >
                {name}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(name);
                }}
                className="mr-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </nav>
        {unopenedTables.length > 0 && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute left-0 top-full z-50 mt-0.5 w-56 rounded-md border bg-popover shadow-md">
                <div className="p-1.5">
                  <Input
                    placeholder="Filter tables..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-7 text-xs"
                    autoFocus
                  />
                </div>
                <div className="max-h-52 overflow-y-auto p-1">
                  {unopenedTables
                    .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                    .map((table) => (
                      <button
                        key={table.name}
                        onClick={() => { openTable(table.name); setSearch(""); }}
                        className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      >
                        <span className="font-mono text-xs">{table.name}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </header>
      )}
      <main className="flex-1 overflow-hidden">
        {activeTab ? (
          <TableView tableName={activeTab} onSelectTable={openTable} />
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <div className="w-full max-w-sm">
              <h2 className="mb-1 text-sm font-medium text-foreground">Tables</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                {tables.length} table{tables.length !== 1 ? "s" : ""} found
              </p>
              <div className="rounded-lg border">
                {tables.map((table, i) => (
                  <button
                    key={table.name}
                    onClick={() => openTable(table.name)}
                    className={cn(
                      "flex w-full items-center px-3 py-2 text-left transition-colors hover:bg-accent",
                      i > 0 && "border-t",
                    )}
                  >
                    <span className="font-mono text-sm">{table.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
