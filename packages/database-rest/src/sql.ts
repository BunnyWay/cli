import type {
  Filter,
  FilterCondition,
  FilterGroup,
  OrderClause,
  ParsedQuery,
} from "./parser.ts";

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface WhereClause {
  sql: string;
  args: (string | number | boolean | null)[];
}

const isGroup = (filter: Filter): filter is FilterGroup =>
  "and" in filter || "or" in filter;

function compileCondition(filter: FilterCondition): WhereClause {
  const col = quoteIdentifier(filter.column);

  switch (filter.operator) {
    case "eq":
      return { sql: `${col} = ?`, args: [filter.value as string | number] };
    case "neq":
      return { sql: `${col} != ?`, args: [filter.value as string | number] };
    case "gt":
      return { sql: `${col} > ?`, args: [filter.value as string | number] };
    case "gte":
      return { sql: `${col} >= ?`, args: [filter.value as string | number] };
    case "lt":
      return { sql: `${col} < ?`, args: [filter.value as string | number] };
    case "lte":
      return { sql: `${col} <= ?`, args: [filter.value as string | number] };
    case "like":
      return { sql: `${col} LIKE ?`, args: [filter.value as string] };
    case "ilike":
      return {
        sql: `${col} LIKE ? COLLATE NOCASE`,
        args: [filter.value as string],
      };
    case "is": {
      if (filter.value === null) {
        return { sql: `${col} IS NULL`, args: [] };
      }

      return {
        sql: filter.value === true ? `${col} IS TRUE` : `${col} IS FALSE`,
        args: [],
      };
    }
    case "in": {
      const values = filter.value as (string | number)[];
      const placeholders = values.map(() => "?").join(", ");

      return { sql: `${col} IN (${placeholders})`, args: values };
    }
  }
}

/** Joins compiled filters with AND or OR. An empty AND is true and an empty OR is false, as in logic. */
function joinFilters(filters: Filter[], joiner: "AND" | "OR"): WhereClause {
  if (filters.length === 0) {
    return { sql: joiner === "AND" ? "1 = 1" : "1 = 0", args: [] };
  }
  const parts = filters.map(compileFilter);

  return {
    sql: parts.map((part) => part.sql).join(` ${joiner} `),
    args: parts.flatMap((part) => part.args),
  };
}

function compileFilter(filter: Filter): WhereClause {
  if (!isGroup(filter)) {
    return compileCondition(filter);
  }
  const inner =
    "and" in filter
      ? joinFilters(filter.and, "AND")
      : joinFilters(filter.or, "OR");

  return { sql: `(${inner.sql})`, args: inner.args };
}

function buildWhere(filters: Filter[]): WhereClause {
  if (filters.length === 0) {
    return { sql: "", args: [] };
  }
  const where = joinFilters(filters, "AND");

  return { sql: ` WHERE ${where.sql}`, args: where.args };
}

/** Every column a filter references, including inside nested groups. */
export function filterColumns(filters: Filter[]): Set<string> {
  const columns = new Set<string>();
  const visit = (filter: Filter) => {
    if (!isGroup(filter)) {
      columns.add(filter.column);
      return;
    }
    for (const child of "and" in filter ? filter.and : filter.or) {
      visit(child);
    }
  };
  for (const filter of filters) {
    visit(filter);
  }

  return columns;
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

export function buildCountQuery(table: string, query: ParsedQuery): CountQuery {
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
  filters: Filter[],
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
  filters: Filter[],
): SelectQuery {
  const where = buildWhere(filters);

  return {
    sql: `DELETE FROM ${quoteIdentifier(table)}${where.sql} RETURNING *`,
    args: where.args,
  };
}

/**
 * Checks a row against filters before it is inserted, without touching the
 * table: the row's values become a one-row derived table and the filters run
 * against it. Returns a row only when the filters match. Every column the
 * filters reference must be present in `row`; callers check that first.
 *
 * Values are compared as sent, without the table's column affinity, so a
 * string "5" does not equal the number 5 here even if an INTEGER column
 * would store it as 5.
 */
export function buildFilterCheckQuery(
  row: Record<string, unknown>,
  filters: Filter[],
): SelectQuery {
  const columns = Object.keys(row);
  const candidate = columns
    .map((column) => `? AS ${quoteIdentifier(column)}`)
    .join(", ");
  const where = buildWhere(filters);

  return {
    sql: `SELECT 1 AS matched FROM (SELECT ${candidate})${where.sql}`,
    args: [
      ...columns.map((column) => row[column] as string | number | null),
      ...where.args,
    ],
  };
}
