import type { TableDefinition } from "@/api";

export function incomingReferences(tables: TableDefinition[], table: string) {
  return tables.flatMap((t) =>
    t.foreignKeys
      .filter((fk) => fk.referencesTable === table)
      .map((fk) => ({
        table: t.name,
        column: fk.column,
        referencesColumn: fk.referencesColumn,
      })),
  );
}
