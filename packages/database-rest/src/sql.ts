import type { FilterCondition, OrderClause, ParsedQuery } from "./parser.ts";

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface WhereClause {
  sql: string;
  args: (string | number | boolean | null)[];
}

function buildWhere(filters: FilterCondition[]): WhereClause {
  if (filters.length === 0) {
    return { sql: "", args: [] };
  }

  const conditions: string[] = [];
  const args: (string | number | boolean | null)[] = [];

  for (const filter of filters) {
    const col = quoteIdentifier(filter.column);

    switch (filter.operator) {
      case "eq":
        conditions.push(`${col} = ?`);
        args.push(filter.value as string | number);
        break;
      case "neq":
        conditions.push(`${col} != ?`);
        args.push(filter.value as string | number);
        break;
      case "gt":
        conditions.push(`${col} > ?`);
        args.push(filter.value as string | number);
        break;
      case "gte":
        conditions.push(`${col} >= ?`);
        args.push(filter.value as string | number);
        break;
      case "lt":
        conditions.push(`${col} < ?`);
        args.push(filter.value as string | number);
        break;
      case "lte":
        conditions.push(`${col} <= ?`);
        args.push(filter.value as string | number);
        break;
      case "like":
        conditions.push(`${col} LIKE ?`);
        args.push(filter.value as string);
        break;
      case "ilike":
        conditions.push(`${col} LIKE ? COLLATE NOCASE`);
        args.push(filter.value as string);
        break;
      case "is": {
        if (filter.value === null) {
          conditions.push(`${col} IS NULL`);
        } else if (filter.value === true) {
          conditions.push(`${col} IS TRUE`);
        } else {
          conditions.push(`${col} IS FALSE`);
        }
        break;
      }
      case "in": {
        const values = filter.value as (string | number)[];
        const placeholders = values.map(() => "?").join(", ");
        conditions.push(`${col} IN (${placeholders})`);
        args.push(...values);
        break;
      }
    }
  }

  return {
    sql: ` WHERE ${conditions.join(" AND ")}`,
    args,
  };
}

function buildOrderBy(order: OrderClause[]): string {
  if (order.length === 0) return "";

  const clauses = order.map((o) => {
    const col = quoteIdentifier(o.column);
    const dir = o.direction.toUpperCase();
    const nulls = o.nullsFirst ? " NULLS FIRST" : "";
    return `${col} ${dir}${nulls}`;
  });

  return ` ORDER BY ${clauses.join(", ")}`;
}

function buildSelect(columns: string[]): string {
  if (columns.length === 0) return "*";
  return columns.map(quoteIdentifier).join(", ");
}

export interface SelectQuery {
  sql: string;
  args: (string | number | boolean | null)[];
}

export interface CountQuery {
  sql: string;
  args: (string | number | boolean | null)[];
}

export function buildSelectQuery(
  table: string,
  query: ParsedQuery,
): SelectQuery {
  const select = buildSelect(query.select);
  const where = buildWhere(query.filters);
  const orderBy = buildOrderBy(query.order);

  let sql = `SELECT ${select} FROM ${quoteIdentifier(table)}${where.sql}${orderBy}`;

  if (query.limit !== undefined) {
    sql += ` LIMIT ${query.limit}`;
  }
  if (query.offset !== undefined) {
    sql += ` OFFSET ${query.offset}`;
  }

  return { sql, args: where.args };
}

export function buildCountQuery(
  table: string,
  query: ParsedQuery,
): CountQuery {
  const where = buildWhere(query.filters);
  return {
    sql: `SELECT COUNT(*) as count FROM ${quoteIdentifier(table)}${where.sql}`,
    args: where.args,
  };
}

export function buildInsertQuery(
  table: string,
  row: Record<string, unknown>,
): SelectQuery {
  const columns = Object.keys(row);
  const colList = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const args = columns.map((c) => row[c] as string | number | null);

  return {
    sql: `INSERT INTO ${quoteIdentifier(table)} (${colList}) VALUES (${placeholders}) RETURNING *`,
    args,
  };
}

export function buildUpdateQuery(
  table: string,
  values: Record<string, unknown>,
  filters: FilterCondition[],
): SelectQuery {
  const setClauses = Object.keys(values).map(
    (col) => `${quoteIdentifier(col)} = ?`,
  );
  const setArgs = Object.values(values) as (string | number | boolean | null)[];
  const where = buildWhere(filters);

  return {
    sql: `UPDATE ${quoteIdentifier(table)} SET ${setClauses.join(", ")}${where.sql} RETURNING *`,
    args: [...setArgs, ...where.args],
  };
}

export function buildDeleteQuery(
  table: string,
  filters: FilterCondition[],
): SelectQuery {
  const where = buildWhere(filters);

  return {
    sql: `DELETE FROM ${quoteIdentifier(table)}${where.sql} RETURNING *`,
    args: where.args,
  };
}
