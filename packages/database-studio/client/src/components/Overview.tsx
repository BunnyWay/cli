import { Eye, KeyRound, SquareTerminal, Table2 } from "lucide-react";
import type { StudioSchema } from "@/api";
import { Button } from "@/components/ui/button";
import { incomingReferences } from "@/lib/schema";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Action({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-primary hover:bg-muted"
    >
      {children}
    </button>
  );
}

const Th = ({ children }: { children?: React.ReactNode }) => (
  <th className="border-b bg-card px-3 py-2 text-left font-medium text-muted-foreground">
    {children}
  </th>
);

/** The database at a glance, like phpMyAdmin's Structure page. */
export function Overview({
  schema,
  missing,
  onSelect,
  onSelectView,
  onOpenSql,
}: {
  schema: StudioSchema;
  /** A table named in the URL that isn't in the schema. */
  missing: string | null;
  onSelect: (name: string, view?: "schema") => void;
  /** Opens a table or view in the SQL console with a starter query. */
  onSelectView: (name: string) => void;
  onOpenSql: () => void;
}) {
  const { tables, views, ddl } = schema;
  const triggers = (table: string) =>
    (ddl[table] ?? []).filter((s) => /^\s*CREATE\s+TRIGGER/i.test(s)).length;
  const totals = {
    indexes: tables.reduce((n, t) => n + t.indexes.length, 0),
    triggers: tables.reduce((n, t) => n + triggers(t.name), 0),
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="flex items-start gap-4">
          <div>
            <h1 className="text-lg font-semibold">Database</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {missing
                ? `There's no table named “${missing}”. Pick one below.`
                : "Browse a table, read its structure, or query it in SQL."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-8 gap-1.5 text-xs"
            onClick={onOpenSql}
          >
            <SquareTerminal className="h-3.5 w-3.5" />
            Open SQL console
          </Button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Tables" value={tables.length} />
          <Stat label="Views" value={views.length} />
          <Stat label="Indexes" value={totals.indexes} />
          <Stat label="Triggers" value={totals.triggers} />
        </div>

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
          <section className="mt-8">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Tables
            </h2>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <Th>Table</Th>
                    <Th>Primary key</Th>
                    <Th>Columns</Th>
                    <Th>Indexes</Th>
                    <Th>Foreign keys</Th>
                    <Th>Referenced by</Th>
                    <Th>Triggers</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {tables.map((t) => (
                    <tr
                      key={t.name}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => onSelect(t.name)}
                          className="inline-flex items-center gap-2 font-mono text-foreground hover:text-primary"
                        >
                          <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {t.name}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {t.primaryKey.length > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <KeyRound className="h-3 w-3 text-primary" />
                            {t.primaryKey.join(", ")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <Count n={t.columns.length} />
                      <Count n={t.indexes.length} />
                      <Count n={t.foreignKeys.length} />
                      <Count n={incomingReferences(tables, t.name).length} />
                      <Count n={triggers(t.name)} />
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Action onClick={() => onSelect(t.name)}>Browse</Action>
                        <Action onClick={() => onSelect(t.name, "schema")}>
                          Structure
                        </Action>
                        <Action onClick={() => onSelectView(t.name)}>
                          SQL
                        </Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {views.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Views
            </h2>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <Th>View</Th>
                    <Th>Columns</Th>
                    <Th>Definition</Th>
                  </tr>
                </thead>
                <tbody>
                  {views.map((v) => (
                    <tr
                      key={v.name}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => onSelectView(v.name)}
                          className="inline-flex items-center gap-2 font-mono text-foreground hover:text-primary"
                        >
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                          {v.name}
                        </button>
                      </td>
                      <Count n={v.columns.length} />
                      <td className="max-w-md truncate px-3 py-2 font-mono text-muted-foreground">
                        {v.sql?.replace(/\s+/g, " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return (
    <td className="px-3 py-2 tabular-nums">
      {n === 0 ? <span className="text-muted-foreground/50">0</span> : n}
    </td>
  );
}
