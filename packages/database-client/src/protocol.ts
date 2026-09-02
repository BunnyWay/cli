import { DatabaseError } from "./errors.ts";

export type SqlValue = null | string | number | bigint | boolean | Uint8Array;

export type WireValue =
  | { type: "null" }
  | { type: "integer"; value: string }
  | { type: "float"; value: number }
  | { type: "text"; value: string }
  | { type: "blob"; base64: string };

export interface WireColumn {
  name: string | null;
  decltype: string | null;
}

export interface WireStmtResult {
  cols: WireColumn[];
  rows: WireValue[][];
  affected_row_count: number;
  last_insert_rowid: string | null;
}

export interface WireBatchResult {
  step_results: (WireStmtResult | null)[];
  step_errors: (WireError | null)[];
}

export interface WireError {
  message: string;
  code?: string | null;
}

export interface WireNamedArg {
  name: string;
  value: WireValue;
}

export interface WireStmt {
  sql: string;
  args: WireValue[];
  named_args: WireNamedArg[];
  want_rows: boolean;
}

type WireRequest =
  | { type: "execute"; stmt: WireStmt }
  | {
      type: "batch";
      batch: { steps: { stmt: WireStmt; condition?: unknown }[] };
    }
  | { type: "sequence"; sql: string }
  | { type: "close" };

interface WireResponse {
  baton: string | null;
  base_url: string | null;
  results: {
    type: "ok" | "error";
    response?: { type: string; result?: WireStmtResult | WireBatchResult };
    error?: WireError;
  }[];
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const INT64_MAX = 2n ** 63n - 1n;
const INT64_MIN = -(2n ** 63n);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const invalid = (message: string) =>
  new DatabaseError(message, { code: "ARGUMENT_INVALID" });

// Node's timers take a signed 32-bit integer; a larger value silently fires after 1ms and a fraction throws.
const MAX_TIMEOUT = 2_147_483_647;

export function encodeValue(value: unknown): WireValue {
  if (value === null) return { type: "null" };
  if (value === undefined) {
    throw invalid("cannot bind undefined; pass null to store SQL NULL");
  }
  if (typeof value === "boolean") {
    return { type: "integer", value: value ? "1" : "0" };
  }
  if (typeof value === "bigint") {
    if (value > INT64_MAX || value < INT64_MIN) {
      throw invalid(
        `cannot bind bigint ${value}; outside SQLite's 64-bit integer range`,
      );
    }
    return { type: "integer", value: value.toString() };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalid(`cannot bind non-finite number: ${value}`);
    }
    // Past 2^53 every double is integral, so send it as the REAL it is rather than guessing at a lost integer.
    return Number.isSafeInteger(value)
      ? { type: "integer", value: value.toString() }
      : { type: "float", value };
  }
  if (typeof value === "string") return { type: "text", value };
  if (value instanceof Uint8Array)
    return { type: "blob", base64: bytesToBase64(value) };
  if (value instanceof ArrayBuffer) {
    return { type: "blob", base64: bytesToBase64(new Uint8Array(value)) };
  }
  if (value instanceof Date) {
    throw invalid(
      "cannot bind a Date; pass date.toISOString() or date.getTime() instead",
    );
  }
  throw invalid(
    `cannot bind value of type ${typeof value}; expected null, boolean, number, bigint, string, or Uint8Array`,
  );
}

/** Widen to bigint only where a number would lose precision. */
export function decodeInteger(value: string): number | bigint {
  const big = BigInt(value);
  return big > MAX_SAFE || big < MIN_SAFE ? big : Number(big);
}

export function decodeValue(value: WireValue): SqlValue {
  switch (value.type) {
    case "null":
      return null;
    case "text":
      return value.value;
    case "float":
      return value.value;
    case "blob":
      return base64ToBytes(value.base64);
    case "integer":
      return decodeInteger(value.value);
    default:
      throw new DatabaseError(
        `unsupported value type from server: ${(value as { type: string }).type}`,
      );
  }
}

const SCHEME_MAP: Record<string, string> = {
  libsql: "https",
  wss: "https",
  https: "https",
  ws: "http",
  http: "http",
};

const invalidUrl = (message: string) =>
  new DatabaseError(message, { code: "URL_INVALID" });

export function normalizeUrl(url: string): string {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(url);
  if (!match) {
    throw invalidUrl(
      `invalid database URL "${url}"; expected a libsql:// or https:// URL`,
    );
  }
  const scheme = (match[1] as string).toLowerCase();
  const mapped = SCHEME_MAP[scheme];
  if (!mapped) {
    throw new DatabaseError(
      `unsupported URL scheme "${scheme}:"; expected libsql:, https:, or http:`,
      { code: "URL_SCHEME_NOT_SUPPORTED" },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(`${mapped}://${url.slice(match[0].length)}`);
  } catch {
    throw invalidUrl(`invalid database URL "${url}"`);
  }
  if (parsed.username || parsed.password) {
    throw invalidUrl(
      "database URL must not contain credentials; pass authToken instead",
    );
  }
  if (parsed.searchParams.has("authToken")) {
    throw invalidUrl(
      "database URL must not carry an authToken query parameter; pass authToken instead",
    );
  }
  if (scheme === "libsql" && parsed.searchParams.get("tls") === "0") {
    parsed.protocol = "http:";
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export interface Transport {
  send(
    requests: WireRequest[],
    signal?: AbortSignal,
  ): Promise<WireResponse["results"]>;
}

const USER_AGENT = "bunny-database-client";

export interface TransportConfig {
  url: string;
  authToken?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  /** Milliseconds before a single request is aborted. Unset means no deadline. */
  timeout?: number;
}

/** Combine the caller's signal with the configured deadline, avoiding a wrapper when only one applies. */
function requestSignal(
  signal: AbortSignal | undefined,
  timeout: number | undefined,
): AbortSignal | undefined {
  if (timeout === undefined) return signal;
  const deadline = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/** Build a stateless transport: every call is one self-contained POST to /v2/pipeline. */
export function createTransport(config: TransportConfig): Transport {
  const { timeout } = config;
  if (
    timeout !== undefined &&
    !(Number.isInteger(timeout) && timeout > 0 && timeout <= MAX_TIMEOUT)
  ) {
    throw invalid(
      `timeout must be a positive integer of milliseconds no larger than ${MAX_TIMEOUT}, got ${timeout}`,
    );
  }
  // v2 is the widest-supported pipeline path and every request we send is v2-capable.
  const endpoint = `${normalizeUrl(config.url)}/v2/pipeline`;
  const doFetch = config.fetch ?? fetch;
  // Lowercased so a caller's User-Agent replaces the default instead of sending both.
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": USER_AGENT,
    ...Object.fromEntries(
      Object.entries(config.headers ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    ),
  };
  if (config.authToken) headers.authorization = `Bearer ${config.authToken}`;

  return {
    async send(requests, signal) {
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            baton: null,
            requests: [...requests, { type: "close" }],
          }),
          signal: requestSignal(signal, timeout),
        });
      } catch (error) {
        throw DatabaseError.fromTransport(error);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw DatabaseError.fromHttp(response.status, body);
      }

      let payload: Partial<WireResponse> | null;
      try {
        payload = (await response.json()) as Partial<WireResponse> | null;
      } catch (error) {
        throw DatabaseError.fromTransport(error);
      }
      if (!Array.isArray(payload?.results)) {
        throw new DatabaseError(
          "database returned a response without results",
          { code: "PROTOCOL" },
        );
      }
      return payload.results;
    },
  };
}

/** Unwrap a pipeline result slot, throwing the server error if the step failed. */
export function unwrap<T>(
  result: WireResponse["results"][number] | undefined,
): T {
  if (!result)
    throw new DatabaseError("server returned no result for a request");
  if (result.type === "error" || result.error) {
    throw DatabaseError.fromWire(result.error);
  }
  return result.response?.result as T;
}
