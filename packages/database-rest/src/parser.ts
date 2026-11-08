export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "in";

export type SortDirection = "asc" | "desc";

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value: string | number | boolean | null | (string | number)[];
}

/**
 * A condition or a nested `and`/`or` group of filters. A list of filters at
 * the top level (as in `ParsedQuery.filters`) is ANDed together.
 */
export type Filter = FilterCondition | FilterGroup;

export type FilterGroup = { and: Filter[] } | { or: Filter[] };

export interface OrderClause {
  column: string;
  direction: SortDirection;
  nullsFirst: boolean;
}

export interface ParsedQuery {
  select: string[];
  filters: Filter[];
  order: OrderClause[];
  limit?: number;
  offset?: number;
}

const FILTER_OPERATORS: Record<string, FilterOperator> = {
  eq: "eq",
  neq: "neq",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  like: "like",
  ilike: "ilike",
  is: "is",
  in: "in",
};

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset"]);

/** Query parameters that hold a filter group, as in `?or=(a.eq.1,b.eq.2)`. */
const GROUP_PARAMS = new Set(["and", "or"]);

/**
 * A query string the parser cannot read safely. Thrown for malformed `and` /
 * `or` groups, because silently dropping one branch of a group would change
 * which rows match. The handler answers it with 400.
 */
export class QueryParseError extends Error {
  override name = "QueryParseError";
}

export function parseSelect(selectParam: string | null): string[] {
  if (!selectParam || selectParam === "*") {
    return [];
  }
  return selectParam
    .split(",")
    .map((col) => col.trim())
    .filter(Boolean);
}

export function parseFilterValue(
  column: string,
  value: string,
): FilterCondition | null {
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1) {
    return {
      column,
      operator: "eq",
      value: parseValue(value),
    };
  }

  const operatorStr = value.substring(0, dotIndex);
  const rawValue = value.substring(dotIndex + 1);

  const operator = FILTER_OPERATORS[operatorStr];
  if (!operator) {
    return null;
  }

  let parsedValue: FilterCondition["value"];

  if (operator === "in") {
    parsedValue = parseInValues(rawValue);
  } else if (operator === "is") {
    parsedValue = parseIsValue(rawValue);
  } else {
    parsedValue = parseValue(rawValue);
  }

  return {
    column,
    operator,
    value: parsedValue,
  };
}

function parseInValues(raw: string): (string | number)[] {
  const match = raw.match(/^\((.+)\)$/);
  const [, inner] = match ?? [];
  if (!inner) {
    return [raw];
  }

  return inner.split(",").map((v) => {
    const trimmed = v.trim();
    const num = Number(trimmed);
    return Number.isNaN(num) ? trimmed : num;
  });
}

function parseIsValue(raw: string): boolean | null {
  const lower = raw.toLowerCase();
  if (lower === "null") return null;
  if (lower === "true") return true;
  if (lower === "false") return false;
  return null;
}

function parseValue(raw: string): string | number {
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== "") {
    return num;
  }
  return raw;
}

/**
 * Splits on commas that are not inside parentheses or double quotes, so
 * `a.eq.1,and(b.eq.2,c.in.(3,4))` yields two parts.
 */
function splitTopLevel(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";

  for (const ch of raw) {
    if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === "(") {
      depth++;
    } else if (!quoted && ch === ")") {
      depth--;
      if (depth < 0) {
        throw new QueryParseError(`Unbalanced parentheses in "${raw}"`);
      }
    } else if (!quoted && depth === 0 && ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  if (depth !== 0 || quoted) {
    throw new QueryParseError(`Unbalanced parentheses or quotes in "${raw}"`);
  }
  parts.push(current);

  return parts.map((part) => part.trim());
}

/** Reads `(item,item,...)`, where each item is `column.operator.value` or a nested `and(...)` / `or(...)`. */
function parseGroupItems(raw: string): Filter[] {
  const match = raw.match(/^\((.*)\)$/s);
  if (!match) {
    throw new QueryParseError(
      `Expected a parenthesised list like (a.eq.1,b.eq.2), got "${raw}"`,
    );
  }
  const [, inner = ""] = match;
  if (inner.trim() === "") {
    throw new QueryParseError("A filter group must not be empty");
  }

  return splitTopLevel(inner).map(parseGroupItem);
}

function parseGroupItem(item: string): Filter {
  const group = item.match(/^(and|or)(\(.*\))$/s);
  if (group) {
    const [, kind, list = ""] = group;
    const children = parseGroupItems(list);

    return kind === "and" ? { and: children } : { or: children };
  }

  const dot = item.indexOf(".");
  const column = dot === -1 ? "" : item.slice(0, dot);
  const rest = dot === -1 ? "" : item.slice(dot + 1);
  // Inside a group the operator is required: "age.18" would be ambiguous.
  if (!column || !rest.includes(".")) {
    throw new QueryParseError(
      `Expected column.operator.value inside a filter group, got "${item}"`,
    );
  }

  const quoted = rest.match(/^([a-z]+)\."(.*)"$/s);
  if (quoted) {
    const [, operator = "", value = ""] = quoted;
    const condition = parseFilterValue(column, `${operator}.x`);
    if (!condition) {
      throw new QueryParseError(`Unknown filter operator "${operator}"`);
    }

    // A quoted value is always a string, so "123" stays text.
    return { ...condition, value };
  }

  const condition = parseFilterValue(column, rest);
  if (!condition) {
    throw new QueryParseError(`Unknown filter operator in "${item}"`);
  }

  return condition;
}

/** Parses the value of an `and` or `or` query parameter into a filter group. */
export function parseFilterGroup(kind: "and" | "or", raw: string): Filter {
  const children = parseGroupItems(raw);

  return kind === "and" ? { and: children } : { or: children };
}

export function parseOrder(orderParam: string | null): OrderClause[] {
  if (!orderParam) {
    return [];
  }

  return orderParam
    .split(",")
    .map((part) => {
      const [column = "", second, ...rest] = part.trim().split(".");
      const direction: SortDirection =
        second?.toLowerCase() === "desc" ? "desc" : "asc";
      const nullsFirst = [second, ...rest].some(
        (s) => s?.toLowerCase() === "nullsfirst",
      );

      return { column, direction, nullsFirst };
    })
    .filter((o) => o.column);
}

export function parseQueryParams(url: URL): ParsedQuery {
  const params = url.searchParams;

  const select = parseSelect(params.get("select"));
  const order = parseOrder(params.get("order"));

  const limitParam = params.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const offsetParam = params.get("offset");
  const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

  const filters: Filter[] = [];

  for (const [key, value] of params.entries()) {
    if (RESERVED_PARAMS.has(key)) {
      continue;
    }

    if (GROUP_PARAMS.has(key)) {
      filters.push(parseFilterGroup(key as "and" | "or", value));
      continue;
    }

    const filter = parseFilterValue(key, value);
    if (filter) {
      filters.push(filter);
    }
  }

  return {
    select,
    filters,
    order,
    limit,
    offset,
  };
}
