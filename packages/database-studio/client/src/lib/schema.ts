import type { TableDefinition } from "@/api";

export interface IncomingReference {
  /** The table holding the foreign key. */
  table: string;
  column: string;
  /** The column it points at in the referenced table. */
  referencesColumn: string;
}

/** Foreign keys in any table that point at `table`. */
export function incomingReferences(
  tables: TableDefinition[],
  table: string,
): IncomingReference[] {
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
