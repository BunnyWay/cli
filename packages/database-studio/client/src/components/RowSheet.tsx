import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Filter,
  KeyRound,
  Link2,
} from "lucide-react";
import { useState } from "react";
import type { OpenTable } from "@/App";
import type { Row, TableDefinition } from "@/api";
import { CellValue } from "@/components/CellValue";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toText } from "@/lib/format";
import { useCopy } from "@/lib/interaction";
import { incomingReferences } from "@/lib/schema";
import { cn } from "@/lib/utils";

export interface SheetEntry {
  table: TableDefinition;
  row: Row;
}

function rowLabel({ table, row }: SheetEntry): string {
  if (table.primaryKey.length === 0) return table.name;
  const key = table.primaryKey.map((c) => toText(row[c])).join(", ");
  return `${table.name} #${key}`;
}

export function RowSheet({
  stack,
  tables,
  onBack,
  onClose,
  onFollowForeignKey,
  onOpenTable,
}: {
  stack: SheetEntry[];
  tables: TableDefinition[];
  onBack: () => void;
  onClose: () => void;
  onFollowForeignKey: (
    table: TableDefinition,
    column: string,
    value: unknown,
  ) => Promise<string | null>;
  onOpenTable: OpenTable;
}) {
  const entry = stack.at(-1);
  const { copied, copy } = useCopy();
  const [followErrors, setFollowErrors] = useState<Record<string, string>>({});

  const incoming = entry ? incomingReferences(tables, entry.table.name) : [];

  return (
    <Sheet
      open={!!entry}
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {entry && (
        <SheetContent
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
          onInteractOutside={(e) => {
            // Clicking another row swaps the sheet's contents instead of closing it.
            if ((e.target as HTMLElement).closest("tbody")) e.preventDefault();
          }}
        >
          <SheetHeader className="shrink-0 space-y-1 border-b px-5 py-4 pr-12">
            {stack.length > 1 && (
              <nav className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                <button
                  type="button"
                  onClick={onBack}
                  className="mr-1 inline-flex items-center gap-1 rounded px-1 hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back
                </button>
                <span className="font-mono">
                  {stack.slice(0, -1).map(rowLabel).join(" › ")} ›
                </span>
              </nav>
            )}
            <div className="flex items-center gap-2">
              <SheetTitle className="truncate font-mono text-sm">
                {rowLabel(entry)}
              </SheetTitle>
              <button
                type="button"
                onClick={() =>
                  copy("__row", JSON.stringify(entry.row, null, 2))
                }
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {copied === "__row" ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Copy JSON
              </button>
            </div>
            <SheetDescription className="sr-only">
              Field values for the selected row
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {entry.table.columns.map((col) => {
              const value = entry.row[col.name];
              const fk = entry.table.foreignKeys.find(
                (f) => f.column === col.name,
              );
              const hasValue = value !== null && value !== undefined;
              const errorKey = `${stack.length}:${col.name}`;
              return (
                <div key={col.name} className="group space-y-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    {entry.table.primaryKey.includes(col.name) && (
                      <KeyRound className="h-3 w-3 text-primary" />
                    )}
                    <span className="font-mono font-medium">{col.name}</span>
                    <span className="text-[10px] uppercase text-muted-foreground/70">
                      {col.type}
                    </span>
                    {fk && (
                      <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                        <Link2 className="h-3 w-3" />
                        {fk.referencesTable}.{fk.referencesColumn}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      {col.type !== "BLOB" && (
                        <IconButton
                          label={`Show ${entry.table.name} rows with this ${col.name}`}
                          onClick={() =>
                            onOpenTable(entry.table.name, [
                              hasValue
                                ? {
                                    column: col.name,
                                    operator: "eq",
                                    value: toText(value),
                                  }
                                : {
                                    column: col.name,
                                    operator: "null",
                                    value: "",
                                  },
                            ])
                          }
                        >
                          <Filter className="h-3 w-3" />
                        </IconButton>
                      )}
                      {hasValue && (
                        <IconButton
                          label="Copy value"
                          onClick={() => copy(col.name, toText(value))}
                        >
                          {copied === col.name ? (
                            <Check className="h-3 w-3 text-green-500" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </IconButton>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <div className="max-h-80 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                      <CellValue value={value} type={col.type} />
                    </div>
                    {fk && hasValue && (
                      <IconButton
                        label={`Open ${fk.referencesTable} row`}
                        className="mt-1"
                        onClick={async () => {
                          const err = await onFollowForeignKey(
                            entry.table,
                            col.name,
                            value,
                          );
                          setFollowErrors((m) => {
                            const { [errorKey]: _, ...rest } = m;
                            return err ? { ...rest, [errorKey]: err } : rest;
                          });
                        }}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
                  </div>
                  {followErrors[errorKey] && (
                    <p className="text-[11px] text-destructive-foreground">
                      {followErrors[errorKey]}
                    </p>
                  )}
                </div>
              );
            })}

            {incoming.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Referenced by
                </h3>
                <div className="space-y-1">
                  {incoming.map((ref) => {
                    const value = entry.row[ref.referencesColumn];
                    if (value === null || value === undefined) return null;
                    return (
                      <button
                        key={`${ref.table}.${ref.column}`}
                        type="button"
                        onClick={() =>
                          onOpenTable(ref.table, [
                            {
                              column: ref.column,
                              operator: "eq",
                              value: toText(value),
                            },
                          ])
                        }
                        className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-muted"
                      >
                        <span className="font-mono">{ref.table}</span>
                        <span className="text-muted-foreground">
                          where{" "}
                          <span className="font-mono">
                            {ref.column} = {toText(value)}
                          </span>
                        </span>
                        <ArrowRight className="ml-auto h-3 w-3 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}

function IconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
