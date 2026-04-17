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

export interface OrderClause {
  column: string;
  direction: SortDirection;
  nullsFirst: boolean;
}

export interface ParsedQuery {
  select: string[];
  filters: FilterCondition[];
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
  if (!match) {
    return [raw];
  }

  return match[1]!.split(",").map((v) => {
    const trimmed = v.trim();
    const num = Number(trimmed);
    return isNaN(num) ? trimmed : num;
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
  if (!isNaN(num) && raw.trim() !== "") {
    return num;
  }
  return raw;
}

export function parseOrder(orderParam: string | null): OrderClause[] {
  if (!orderParam) {
    return [];
  }

  return orderParam
    .split(",")
    .map((part) => {
      const segments = part.trim().split(".");
      const column = segments[0]!;
      const direction: SortDirection =
        segments[1]?.toLowerCase() === "desc" ? "desc" : "asc";
      const nullsFirst = segments.some((s) => s.toLowerCase() === "nullsfirst");

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

  const filters: FilterCondition[] = [];

  for (const [key, value] of params.entries()) {
    if (RESERVED_PARAMS.has(key)) {
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

export function parseTableFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  return segments[segments.length - 1]!;
}
