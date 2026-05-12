import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { FilterCondition, FilterMode } from "@/api.ts";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const OPERATORS = [
  { value: "=", label: "=" },
  { value: "!=", label: "!=" },
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "LIKE", label: "LIKE" },
  { value: "NOT LIKE", label: "NOT LIKE" },
  { value: "IS NULL", label: "IS NULL" },
  { value: "IS NOT NULL", label: "IS NOT NULL" },
];

export const NULLARY_OPERATORS = new Set(["IS NULL", "IS NOT NULL"]);

export interface FilterBarProps {
  columns: { name: string; type: string }[];
  appliedFilters: FilterCondition[];
  filterRowCount: number;
  onFilterRowCountChange: (count: number) => void;
  filterMode: FilterMode;
  onApply: (
    refs: Map<
      number,
      { column: string; operator: string; valueRef: HTMLInputElement | null }
    >,
    mode?: FilterMode,
  ) => void;
}

export function FilterBar({
  columns,
  appliedFilters,
  filterRowCount,
  onFilterRowCountChange,
  filterMode,
  onApply,
}: FilterBarProps) {
  // Store refs for each filter row's select/input values
  const rowRefs = useRef<
    Map<
      number,
      { column: string; operator: string; valueRef: HTMLInputElement | null }
    >
  >(new Map());

  // Initialize refs from applied filters
  useEffect(() => {
    for (let i = 0; i < appliedFilters.length; i++) {
      if (!rowRefs.current.has(i)) {
        rowRefs.current.set(i, {
          column: appliedFilters[i].column,
          operator: appliedFilters[i].operator,
          valueRef: null,
        });
      }
    }
  }, [appliedFilters]);

  const count = Math.max(filterRowCount, 0);
  const indices = Array.from({ length: count }, (_, i) => i);

  function addRow() {
    const newIndex = count;
    rowRefs.current.set(newIndex, {
      column: columns[0]?.name ?? "",
      operator: "=",
      valueRef: null,
    });
    onFilterRowCountChange(count + 1);
  }

  function removeRow(index: number) {
    rowRefs.current.delete(index);
    const remaining = indices.filter((i) => i !== index);
    const newRefs = new Map<
      number,
      { column: string; operator: string; valueRef: HTMLInputElement | null }
    >();
    remaining.forEach((oldIdx, newIdx) => {
      const ref = rowRefs.current.get(oldIdx);
      if (ref) newRefs.set(newIdx, ref);
    });
    rowRefs.current = newRefs;
    onFilterRowCountChange(remaining.length);
    onApply(newRefs);
  }

  function clearAll() {
    rowRefs.current.clear();
    onFilterRowCountChange(0);
    onApply(new Map());
  }

  function apply() {
    onApply(rowRefs.current);
  }

  return (
    <div className="shrink-0 border-b bg-card/50 px-4 py-2 space-y-2">
      {indices.map((i) => {
        const applied = appliedFilters[i];
        const ref = rowRefs.current.get(i);
        const defaultColumn =
          ref?.column ?? applied?.column ?? columns[0]?.name ?? "";
        const defaultOperator = ref?.operator ?? applied?.operator ?? "=";
        const defaultValue = applied?.value ?? "";

        if (!rowRefs.current.has(i)) {
          rowRefs.current.set(i, {
            column: defaultColumn,
            operator: defaultOperator,
            valueRef: null,
          });
        }

        return (
          <div key={i} className="flex items-center gap-2">
            <Select
              defaultValue={defaultColumn}
              onValueChange={(value) => {
                const r = rowRefs.current.get(i);
                if (r) r.column = value;
              }}
            >
              <SelectTrigger className="h-7 w-auto gap-1.5 font-mono text-xs [&>svg]:h-3 [&>svg]:w-3">
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
              defaultValue={defaultOperator}
              onValueChange={(value) => {
                const r = rowRefs.current.get(i);
                if (r) r.operator = value;
              }}
            >
              <SelectTrigger className="h-7 w-auto gap-1.5 font-mono text-xs [&>svg]:h-3 [&>svg]:w-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPERATORS.map((op) => (
                  <SelectItem
                    key={op.value}
                    value={op.value}
                    className="font-mono text-xs"
                  >
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              ref={(el) => {
                const r = rowRefs.current.get(i);
                if (r) r.valueRef = el;
              }}
              defaultValue={defaultValue}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              placeholder="Value..."
              className="h-7 w-40 font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => removeRow(i)}
            >
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={addRow}
        >
          <Plus className="h-3 w-3" />
          Add filter
        </Button>
        {count > 0 && (
          <>
            {count > 1 && (
              <ButtonGroup>
                <Button
                  variant={filterMode === "and" ? "secondary" : "outline"}
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => onApply(rowRefs.current, "and")}
                >
                  AND
                </Button>
                <Button
                  variant={filterMode === "or" ? "secondary" : "outline"}
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => onApply(rowRefs.current, "or")}
                >
                  OR
                </Button>
              </ButtonGroup>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="h-6 text-xs"
              onClick={apply}
            >
              Apply
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              onClick={clearAll}
            >
              Clear all
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
