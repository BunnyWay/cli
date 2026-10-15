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
  /** Set by the `not.` prefix (`?name=not.like.a%25`); the condition is wrapped in `NOT (...)`. */
  negate?: boolean;
}

/** One `or=(...)` parameter: matches rows where any condition holds. */
export interface FilterGroup {
  or: FilterCondition[];
}

export type Filter = FilterCondition | FilterGroup;

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

/** Thrown for query parameters that can't be applied safely; the handler answers 400. */
export class QueryParseError extends Error {}

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

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "or"]);

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

  if (operatorStr === "not") {
    const inner = parseFilterValue(column, rawValue);
    if (!inner || inner.negate || !rawValue.includes(".")) return null;
    return { ...inner, negate: true };
  }

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

  return inner.split(",").map((v) => parseValue(v.trim()));
}

function parseIsValue(raw: string): boolean | null {
  const lower = raw.toLowerCase();
  if (lower === "null") return null;
  if (lower === "true") return true;
  if (lower === "false") return false;
  return null;
}

/**
 * A value becomes a number only when it's written the way a number prints
 * (`18`, `-2.5`): then it compares correctly against any column, and SQLite's
 * TEXT affinity still turns it back into `'18'` for a TEXT column. Anything
 * else stays a string so it matches as written: `007` and `1e3` would
 * otherwise become 7 and 1000 and miss TEXT values, and integers beyond 2^53
 * would lose precision (INTEGER affinity still compares those strings as
 * integers).
 */
export function parseValue(raw: string): string | number {
  const num = Number(raw);
  return Number.isFinite(num) &&
    Number.isSafeInteger(Math.trunc(num)) &&
    String(num) === raw
    ? num
    : raw;
}

/**
 * Split on commas that sit outside parentheses and double quotes, so
 * `a.in.(1,2),b.eq."x,y"` yields two parts. Inside quotes, a backslash escapes
 * the next character.
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let current = "";
  for (const ch of input) {
    if (escaped) escaped = false;
    else if (quoted && ch === "\\") escaped = true;
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "(") depth++;
    else if (!quoted && ch === ")") depth--;
    if (ch === "," && depth === 0 && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Parse an `or=(col.op.value,...)` parameter. Values may be wrapped in double
 * quotes to carry commas or parentheses; inside quotes, a backslash escapes the
 * next character. Returns null when any condition is malformed: dropping one
 * branch of an OR would widen the match.
 */
export function parseOrGroup(raw: string): FilterGroup | null {
  const match = raw.match(/^\((.*)\)$/s);
  if (!match?.[1]) return null;

  const conditions: FilterCondition[] = [];
  for (const part of splitTopLevel(match[1])) {
    const dotIndex = part.indexOf(".");
    if (dotIndex <= 0) return null;
    const column = part.substring(0, dotIndex).trim();
    let rest = part.substring(dotIndex + 1);
    // `op."value"` (and `not.op."value"`): the quotes make it a literal string.
    const quoted = rest.match(/^((?:not\.)?[a-z]+\.)"(.*)"$/s);
    const literal = quoted?.[2]?.replace(/\\(.)/gs, "$1");
    if (quoted?.[1]) rest = `${quoted[1]}${literal}`;
    const condition = parseFilterValue(column, rest);
    if (!condition || !rest.includes(".")) return null;
    if (
      literal !== undefined &&
      condition.operator !== "in" &&
      condition.operator !== "is"
    ) {
      condition.value = literal;
    }
    conditions.push(condition);
  }
  return { or: conditions };
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

  for (const orParam of params.getAll("or")) {
    const group = parseOrGroup(orParam);
    if (!group) {
      throw new QueryParseError(`Invalid or filter: ${orParam}`);
    }
    filters.push(group);
  }

  for (const [key, value] of params.entries()) {
    if (RESERVED_PARAMS.has(key)) {
      continue;
    }

    const filter = parseFilterValue(key, value);
    if (!filter) {
      // Dropping a filter would widen the match, so refuse it instead.
      throw new QueryParseError(`Invalid filter: ${key}=${value}`);
    }
    filters.push(filter);
  }

  return {
    select,
    filters,
    order,
    limit,
    offset,
  };
}
