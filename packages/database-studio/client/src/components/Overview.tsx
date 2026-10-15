import { KeyRound, Link2, Table2 } from "lucide-react";
import type { TableDefinition } from "@/api";

export function Overview({
  tables,
  missing,
  onSelect,
}: {
  tables: TableDefinition[];
  /** A table named in the URL that isn't in the schema. */
  missing: string | null;
  onSelect: (name: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-10">
        <h1 className="text-lg font-semibold">Tables</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {missing
            ? `There's no table named “${missing}”. Pick one below.`
            : "Pick a table to browse its rows and schema."}
        </p>

        {tables.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">
              This database has no tables yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create one with{" "}
              <code className="font-mono text-foreground">bunny db shell</code>{" "}
              or a migration, then restart studio.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {tables.map((table) => (
              <button
                key={table.name}
                type="button"
                onClick={() => onSelect(table.name)}
                className="group rounded-lg border bg-card p-4 text-left transition-colors hover:border-ring/60"
              >
                <div className="flex items-center gap-2">
                  <Table2 className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                  <span className="truncate font-mono text-sm">
                    {table.name}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>
                    {table.columns.length} column
                    {table.columns.length === 1 ? "" : "s"}
                  </span>
                  {table.primaryKey.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <KeyRound className="h-3 w-3" />
                      <span className="max-w-[120px] truncate font-mono">
                        {table.primaryKey.join(", ")}
                      </span>
                    </span>
                  )}
                  {table.foreignKeys.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Link2 className="h-3 w-3" />
                      {table.foreignKeys.length}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
