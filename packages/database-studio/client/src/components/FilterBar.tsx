import { Plus, X } from "lucide-react";
import { useState } from "react";
import type { ColumnDefinition } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type FilterCondition,
  type FilterMode,
  isComplete,
  isNullary,
  OPERATOR_IDS,
  OPERATORS,
  type OperatorId,
} from "@/lib/filters";
import { cn } from "@/lib/utils";

interface Draft extends FilterCondition {
  id: number;
}

let nextId = 0;
const draft = (f: FilterCondition): Draft => ({ ...f, id: nextId++ });

function defaultOperator(column?: ColumnDefinition): OperatorId {
  return column?.type === "TEXT" ? "contains" : "eq";
}

export function FilterBar({
  columns,
  applied,
  mode,
  onApply,
}: {
  columns: ColumnDefinition[];
  applied: FilterCondition[];
  mode: FilterMode;
  onApply: (filters: FilterCondition[], mode: FilterMode) => void;
}) {
  // Re-mounted via key when the applied filters change, so drafts start from the URL.
  const blank = () =>
    draft({
      column: columns[0]?.name ?? "",
      operator: defaultOperator(columns[0]),
      value: "",
    });
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    applied.length > 0 ? applied.map(draft) : [blank()],
  );

  const strip = (ds: Draft[]): FilterCondition[] =>
    ds.map(({ column, operator, value }) => ({ column, operator, value }));
  const dirty =
    JSON.stringify(strip(drafts).filter(isComplete)) !==
    JSON.stringify(applied);

  function update(id: number, patch: Partial<FilterCondition>) {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function remove(id: number) {
    const next = drafts.filter((d) => d.id !== id);
    setDrafts(next);
    onApply(strip(next), mode);
  }

  return (
    <div className="shrink-0 space-y-1.5 border-b bg-card/40 px-3 py-2">
      {drafts.map((d, i) => (
        <div key={d.id} className="flex items-center gap-1.5">
          <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground">
            {i === 0 ? (
              "where"
            ) : i === 1 ? (
              <button
                type="button"
                onClick={() =>
                  onApply(strip(drafts), mode === "and" ? "or" : "and")
                }
                title="Switch between matching all and any filters"
                className="rounded border px-1 font-mono uppercase hover:bg-muted hover:text-foreground"
              >
                {mode}
              </button>
            ) : (
              <span className="font-mono uppercase">{mode}</span>
            )}
          </span>
          <Select
            value={d.column}
            onValueChange={(column) => {
              const col = columns.find((c) => c.name === column);
              update(d.id, {
                column,
                ...(d.value === "" && { operator: defaultOperator(col) }),
              });
            }}
          >
            <SelectTrigger className="h-7 w-44 gap-1.5 font-mono text-xs [&>svg]:h-3 [&>svg]:w-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {columns.map((col) => (
                <SelectItem
                  key={col.name}
                  value={col.name}
                  className="font-mono text-xs"
                >
                  {col.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={d.operator}
            onValueChange={(operator) =>
              update(d.id, { operator: operator as OperatorId })
            }
          >
            <SelectTrigger className="h-7 w-36 gap-1.5 text-xs [&>svg]:h-3 [&>svg]:w-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATOR_IDS.map((op) => (
                <SelectItem key={op} value={op} className="text-xs">
                  {OPERATORS[op].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isNullary(d.operator) && (
            <input
              value={d.value}
              onChange={(e) => update(d.id, { value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") onApply(strip(drafts), mode);
              }}
              placeholder={d.operator === "in" ? "a, b, c" : "value"}
              aria-label="Filter value"
              // biome-ignore lint/a11y/noAutofocus: a freshly added filter is about to be typed into
              autoFocus={d.value === "" && i === drafts.length - 1}
              className="h-7 w-56 rounded-md border bg-background px-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          )}
          <button
            type="button"
            onClick={() => remove(d.id)}
            title="Remove filter"
            aria-label="Remove filter"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5 pl-[3.375rem]">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={() => setDrafts((ds) => [...ds, blank()])}
        >
          <Plus className="h-3 w-3" />
          Add filter
        </Button>
        <Button
          size="sm"
          className={cn("h-6 px-2.5 text-xs", !dirty && "opacity-60")}
          onClick={() => onApply(strip(drafts), mode)}
        >
          Apply
        </Button>
        {applied.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => onApply([], "and")}
          >
            Clear all
          </Button>
        )}
        {dirty && (
          <span className="text-[11px] text-muted-foreground">
            Press Enter to apply
          </span>
        )}
      </div>
    </div>
  );
}
