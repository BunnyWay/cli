import type { Client } from "@libsql/client";
import type {
  ColumnDefinition,
  ColumnType,
  DatabaseSchema,
  ForeignKey,
  TableDefinition,
} from "@bunny.net/database-openapi";

function mapColumnType(sqliteType: string): ColumnType {
  const upper = sqliteType.toUpperCase();

  if (upper.includes("INT")) return "INTEGER";
  if (upper.includes("CHAR") || upper.includes("CLOB") || upper.includes("TEXT"))
    return "TEXT";
  if (upper.includes("BLOB") || upper === "") return "BLOB";
  if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB"))
    return "REAL";
  if (upper.includes("BOOL")) return "BOOLEAN";
  if (upper.includes("DATE") || upper.includes("TIME")) return "DATETIME";

  return "TEXT";
}

async function getTables(client: Client): Promise<string[]> {
  const result = await client.execute(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE '_litestream_%'
    AND name NOT LIKE 'libsql_%'
    ORDER BY name
  `);

  return result.rows.map((row) => row.name as string);
}

async function getColumns(
  client: Client,
  tableName: string,
): Promise<ColumnDefinition[]> {
  const result = await client.execute(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);

  return result.rows.map((row) => ({
    name: row.name as string,
    type: mapColumnType(row.type as string),
    nullable: row.notnull === 0,
    primaryKey: row.pk === 1,
    defaultValue: row.dflt_value as string | number | null,
  }));
}

async function getForeignKeys(
  client: Client,
  tableName: string,
): Promise<ForeignKey[]> {
  const result = await client.execute(
    `PRAGMA foreign_key_list("${tableName.replace(/"/g, '""')}")`,
  );

  return result.rows.map((row) => ({
    column: row.from as string,
    referencesTable: row.table as string,
    referencesColumn: row.to as string,
  }));
}

async function introspectTable(
  client: Client,
  tableName: string,
): Promise<TableDefinition> {
  const columns = await getColumns(client, tableName);
  const foreignKeys = await getForeignKeys(client, tableName);
  const primaryKey = columns.filter((c) => c.primaryKey).map((c) => c.name);

  return {
    name: tableName,
    columns,
    primaryKey,
    foreignKeys,
  };
}

export interface IntrospectOptions {
  client: Client;
  version?: string;
}

export const introspect = async ({
  client,
  version = "1.0.0",
}: IntrospectOptions): Promise<DatabaseSchema> => {
  const tableNames = await getTables(client);
  const tables: Record<string, TableDefinition> = {};

  for (const tableName of tableNames) {
    tables[tableName] = await introspectTable(client, tableName);
  }

  return {
    tables,
    version,
    generatedAt: new Date().toISOString(),
  };
};
