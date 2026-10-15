import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import type { OpenTable } from "@/App";
import type { TableDefinition } from "@/api";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">{children}</table>
      </div>
    </section>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="border-b bg-card px-3 py-2 text-left font-medium text-muted-foreground">
      {children}
    </th>
  );
}

function Td({
  children,
  mono = false,
}: {
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      className={`border-b px-3 py-2 align-top group-last:border-b-0 ${mono ? "font-mono" : ""}`}
    >
      {children}
    </td>
  );
}

function TableLink({
  name,
  onOpenTable,
}: {
  name: string;
  onOpenTable: OpenTable;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenTable(name)}
      className="font-mono text-primary hover:underline"
    >
      {name}
    </button>
  );
}

/** A sole INTEGER PRIMARY KEY aliases the rowid: SQLite reports it nullable, but it never is. */
function isRowid(table: TableDefinition, column: string): boolean {
  return (
    table.primaryKey.length === 1 &&
    table.primaryKey[0] === column &&
    table.columns.find((c) => c.name === column)?.type === "INTEGER"
  );
}

export function SchemaTab({
  table,
  tables,
  ddl,
  onOpenTable,
}: {
  table: TableDefinition;
  tables: TableDefinition[];
  ddl: string[];
  onOpenTable: OpenTable;
}) {
  const [copied, setCopied] = useState(false);
  const definition = ddl.map((s) => `${s.trim()};`).join("\n\n");
  const foreignKeys = new Map(table.foreignKeys.map((fk) => [fk.column, fk]));
  const unique = new Set(table.uniqueColumns);
  const incoming = tables.flatMap((t) =>
    t.foreignKeys
      .filter((fk) => fk.referencesTable === table.name)
      .map((fk) => ({ table: t.name, ...fk })),
  );

  return (
    <div className="flex-1 overflow-auto p-6">
      <Section title={`Columns (${table.columns.length})`}>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Nullable</Th>
            <Th>Default</Th>
            <Th>Constraints</Th>
          </tr>
        </thead>
        <tbody>
          {table.columns.map((col) => {
            const fk = foreignKeys.get(col.name);
            return (
              <tr key={col.name} className="group">
                <Td mono>
                  <span className="inline-flex items-center gap-1.5">
                    {col.primaryKey && (
                      <KeyRound className="h-3 w-3 text-primary" />
                    )}
                    {col.name}
                  </span>
                </Td>
                <Td mono>
                  <span className="text-muted-foreground">{col.type}</span>
                </Td>
                <Td>
                  {col.nullable && !isRowid(table, col.name) ? (
                    <span className="text-muted-foreground">yes</span>
                  ) : (
                    "NOT NULL"
                  )}
                </Td>
                <Td mono>
                  {col.defaultValue === null ||
                  col.defaultValue === undefined ? (
                    <span className="text-muted-foreground/60">—</span>
                  ) : (
                    String(col.defaultValue)
                  )}
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1.5">
                    {col.primaryKey && <Tag>PRIMARY KEY</Tag>}
                    {unique.has(col.name) && <Tag>UNIQUE</Tag>}
                    {fk && (
                      <Tag>
                        →{" "}
                        <TableLink
                          name={fk.referencesTable}
                          onOpenTable={onOpenTable}
                        />
                        .{fk.referencesColumn}
                      </Tag>
                    )}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Section>

      {table.indexes.length > 0 && (
        <Section title={`Indexes (${table.indexes.length})`}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Columns</Th>
              <Th>Unique</Th>
            </tr>
          </thead>
          <tbody>
            {table.indexes.map((idx) => (
              <tr key={idx.name} className="group">
                <Td mono>{idx.name}</Td>
                <Td mono>{idx.columns.join(", ")}</Td>
                <Td>
                  {idx.unique ? (
                    <Tag>UNIQUE</Tag>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Section>
      )}

      {incoming.length > 0 && (
        <Section title={`Referenced by (${incoming.length})`}>
          <thead>
            <tr>
              <Th>Table</Th>
              <Th>Column</Th>
              <Th>References</Th>
            </tr>
          </thead>
          <tbody>
            {incoming.map((ref) => (
              <tr key={`${ref.table}.${ref.column}`} className="group">
                <Td>
                  <TableLink name={ref.table} onOpenTable={onOpenTable} />
                </Td>
                <Td mono>{ref.column}</Td>
                <Td mono>
                  {table.name}.{ref.referencesColumn}
                </Td>
              </tr>
            ))}
          </tbody>
        </Section>
      )}
      {definition && (
        <section className="mb-8">
          <div className="mb-2 flex items-center">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Definition
            </h3>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(definition).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                })
              }
              className="ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              Copy SQL
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-card p-4 font-mono text-xs leading-relaxed">
            {definition}
          </pre>
        </section>
      )}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}
