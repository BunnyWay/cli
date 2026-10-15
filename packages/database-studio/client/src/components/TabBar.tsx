import { Lock, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { StudioSchema } from "@/api";
import { DatabaseIcon } from "@/components/DatabaseIcon";
import { Popover } from "@/components/Popover";
import { TablePicker } from "@/components/TablePicker";
import { cn } from "@/lib/utils";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function TabBar({
  schema,
  openTabs,
  activeTab,
  pickerOpen,
  onPickerOpenChange,
  onSelect,
  onClose,
  onHome,
}: {
  schema: StudioSchema;
  openTabs: string[];
  activeTab: string | null;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onSelect: (name: string) => void;
  onClose: (name: string) => void;
  onHome: () => void;
}) {
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeTab) return;
    navRef.current
      ?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(activeTab)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  return (
    <header className="flex h-10 shrink-0 items-stretch border-b bg-sidebar">
      <button
        type="button"
        onClick={onHome}
        title="All tables"
        aria-label="All tables"
        className={cn(
          "flex w-10 shrink-0 items-center justify-center border-r hover:bg-background/50",
          activeTab === null ? "text-primary" : "text-muted-foreground",
        )}
      >
        <DatabaseIcon className="h-4 w-4" />
      </button>

      <nav
        ref={navRef}
        aria-label="Open tables"
        className="flex min-w-0 overflow-x-auto [scrollbar-width:none]"
      >
        {openTabs.map((name) => (
          <div
            key={name}
            data-tab={name}
            className={cn(
              "group relative flex shrink-0 items-center border-r",
              name === activeTab
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          >
            {name === activeTab && (
              <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
            )}
            <button
              type="button"
              onClick={() => onSelect(name)}
              onAuxClick={(e) => {
                // Middle-click closes, as in a browser.
                if (e.button === 1) onClose(name);
              }}
              className="h-full pl-3 pr-1.5 font-mono text-xs"
            >
              {name}
            </button>
            <button
              type="button"
              onClick={() => onClose(name)}
              title={`Close ${name}`}
              aria-label={`Close ${name}`}
              className={cn(
                "mr-1.5 rounded p-0.5 hover:bg-muted",
                name === activeTab
                  ? "opacity-60 hover:opacity-100"
                  : "opacity-0 group-hover:opacity-60 hover:!opacity-100",
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </nav>

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => onPickerOpenChange(!pickerOpen)}
          title={`Open a table (${isMac ? "⌘K" : "Ctrl K"})`}
          aria-label="Open a table"
          className={cn(
            "flex h-full w-10 items-center justify-center hover:text-foreground",
            pickerOpen ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <Plus className="h-4 w-4" />
        </button>
        <Popover open={pickerOpen} onClose={() => onPickerOpenChange(false)}>
          <TablePicker
            tables={schema.tables}
            openTabs={openTabs}
            onSelect={onSelect}
          />
        </Popover>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 pl-3 pr-3">
        {schema.label && (
          <span
            className="hidden max-w-80 truncate font-mono text-[11px] text-muted-foreground md:block"
            title={schema.label}
          >
            {schema.label}
          </span>
        )}
        <span
          className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
          title="Studio only reads data. Nothing you do here changes the database."
        >
          <Lock className="h-2.5 w-2.5" />
          Read-only
        </span>
      </div>
    </header>
  );
}
