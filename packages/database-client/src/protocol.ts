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

interface WireStmt {
  sql: string;
  args: WireValue[];
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

export function encodeValue(value: unknown): WireValue {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "boolean") {
    return { type: "integer", value: value ? "1" : "0" };
  }
  if (typeof value === "bigint") {
    if (value > INT64_MAX || value < INT64_MIN) {
      throw new DatabaseError(
        `cannot bind bigint ${value}; outside SQLite's 64-bit integer range`,
        "ARGUMENT_INVALID",
      );
    }
    return { type: "integer", value: value.toString() };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DatabaseError(
        `cannot bind non-finite number: ${value}`,
        "ARGUMENT_INVALID",
      );
    }
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        throw new DatabaseError(
          `cannot bind unsafe integer ${value}; numbers past 2^53 have already lost precision, pass a bigint instead`,
          "ARGUMENT_INVALID",
        );
      }
      return { type: "integer", value: value.toString() };
    }
    return { type: "float", value };
  }
  if (typeof value === "string") return { type: "text", value };
  if (value instanceof Uint8Array)
    return { type: "blob", base64: bytesToBase64(value) };
  if (value instanceof ArrayBuffer) {
    return { type: "blob", base64: bytesToBase64(new Uint8Array(value)) };
  }
  if (value instanceof Date) {
    throw new DatabaseError(
      "cannot bind a Date; pass date.toISOString() or date.getTime() instead",
      "ARGUMENT_INVALID",
    );
  }
  throw new DatabaseError(
    `cannot bind value of type ${typeof value}; expected null, boolean, number, bigint, string, or Uint8Array`,
    "ARGUMENT_INVALID",
  );
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
    case "integer": {
      const big = BigInt(value.value);
      return big > MAX_SAFE || big < MIN_SAFE ? big : Number(big);
    }
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

export function normalizeUrl(url: string): string {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(url);
  if (!match) {
    throw new DatabaseError(
      `invalid database URL "${url}"; expected a libsql:// or https:// URL`,
      "URL_INVALID",
    );
  }
  const scheme = (match[1] as string).toLowerCase();
  const mapped = SCHEME_MAP[scheme];
  if (!mapped) {
    throw new DatabaseError(
      `unsupported URL scheme "${scheme}:"; expected libsql:, https:, or http:`,
      "URL_SCHEME_NOT_SUPPORTED",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(`${mapped}://${url.slice(match[0].length)}`);
  } catch {
    throw new DatabaseError(`invalid database URL "${url}"`, "URL_INVALID");
  }
  if (parsed.username || parsed.password) {
    throw new DatabaseError(
      "database URL must not contain credentials; pass authToken instead",
      "URL_INVALID",
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

export interface TransportConfig {
  url: string;
  authToken?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

/** Build a stateless transport: every call is one self-contained POST to /v2/pipeline. */
export function createTransport(config: TransportConfig): Transport {
  // v2 is the widest-supported pipeline path and every request we send is v2-capable.
  const endpoint = `${normalizeUrl(config.url)}/v2/pipeline`;
  const doFetch = config.fetch ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...config.headers,
  };
  if (config.authToken) headers.authorization = `Bearer ${config.authToken}`;

  return {
    async send(requests, signal) {
      const response = await doFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          baton: null,
          requests: [...requests, { type: "close" }],
        }),
        signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw DatabaseError.fromHttp(response.status, body);
      }

      const payload = (await response.json()) as WireResponse;
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
