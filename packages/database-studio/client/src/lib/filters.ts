export type FilterMode = "and" | "or";

export interface FilterCondition {
  column: string;
  operator: OperatorId;
  value: string;
}

interface Operator {
  label: string;
  /** Operators like IS NULL take no value. */
  nullary?: boolean;
  /** The `op.value` part of a REST filter (`not.` prefix included). */
  encode: (value: string) => string;
}

// LIKE patterns: `%` and `_` in the user's value stay wildcards, which is
// what people typing into a "contains" box usually expect anyway.
export const OPERATORS = {
  eq: { label: "equals", encode: (v) => `eq.${v}` },
  neq: { label: "not equal", encode: (v) => `neq.${v}` },
  contains: { label: "contains", encode: (v) => `ilike.%${v}%` },
  not_contains: { label: "doesn't contain", encode: (v) => `not.ilike.%${v}%` },
  starts: { label: "starts with", encode: (v) => `ilike.${v}%` },
  ends: { label: "ends with", encode: (v) => `ilike.%${v}` },
  gt: { label: ">", encode: (v) => `gt.${v}` },
  gte: { label: "≥", encode: (v) => `gte.${v}` },
  lt: { label: "<", encode: (v) => `lt.${v}` },
  lte: { label: "≤", encode: (v) => `lte.${v}` },
  in: {
    label: "is one of",
    encode: (v) =>
      `in.(${v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",")})`,
  },
  like: { label: "LIKE", encode: (v) => `like.${v}` },
  not_like: { label: "NOT LIKE", encode: (v) => `not.like.${v}` },
  null: { label: "is NULL", nullary: true, encode: () => "is.null" },
  not_null: {
    label: "is not NULL",
    nullary: true,
    encode: () => "not.is.null",
  },
} satisfies Record<string, Operator>;

export type OperatorId = keyof typeof OPERATORS;

export const OPERATOR_IDS = Object.keys(OPERATORS) as OperatorId[];

export function isOperator(id: unknown): id is OperatorId {
  return typeof id === "string" && Object.hasOwn(OPERATORS, id);
}

export function isNullary(id: OperatorId): boolean {
  return "nullary" in OPERATORS[id];
}

/** A filter is ready to send once it has a value, unless its operator needs none. */
export function isComplete(f: FilterCondition): boolean {
  return isNullary(f.operator) || f.value !== "";
}

/** Quote a value for an `or=(...)` group when it carries characters the group syntax uses. */
function quoteForGroup(encoded: string): string {
  const dot = encoded.startsWith("not.")
    ? encoded.indexOf(".", 4)
    : encoded.indexOf(".");
  const op = encoded.slice(0, dot + 1);
  const value = encoded.slice(dot + 1);
  // `in.(…)` is already parenthesised and parsed as a list.
  if (op.endsWith("in.") || !/[,()"\\]/.test(value)) return encoded;
  return `${op}"${value.replace(/[\\"]/g, "\\$&")}"`;
}

/** Query parameters the REST handler reads as paging or options, not as column filters. */
const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "or"]);

const groupPart = (f: FilterCondition) =>
  `${f.column}.${quoteForGroup(OPERATORS[f.operator].encode(f.value))}`;

/** Query parameters for the REST handler: one per filter, or a single `or=(...)` group. */
export function filterParams(
  filters: FilterCondition[],
  mode: FilterMode,
): [string, string][] {
  const ready = filters.filter(isComplete);
  if (mode === "or" && ready.length > 1) {
    return [["or", `(${ready.map(groupPart).join(",")})`]];
  }
  return ready.map((f): [string, string] =>
    // A column named `limit` or `order` would collide with the paging
    // parameter, so its filter goes in a one-condition group instead.
    RESERVED_PARAMS.has(f.column)
      ? ["or", `(${groupPart(f)})`]
      : [f.column, OPERATORS[f.operator].encode(f.value)],
  );
}
