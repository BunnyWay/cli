export type ColumnType =
  | "INTEGER"
  | "REAL"
  | "BOOLEAN"
  | "DATETIME"
  | "BLOB"
  | "TEXT";

export interface ColumnDefinition {
  name: string;
  type: ColumnType;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string | number | null;
}

export interface ForeignKey {
  column: string;
  referencesTable: string;
  referencesColumn: string;
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
}

export interface DatabaseSchema {
  tables: Record<string, TableDefinition>;
  version: string;
  generatedAt?: string;
}

export interface GenerateOptions {
  title?: string;
  version?: string;
  description?: string;
}
