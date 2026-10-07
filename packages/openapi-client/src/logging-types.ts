/**
 * Hand-authored types for the CDN Logging API v2 (`logging.bunnycdn.com`).
 * No OpenAPI spec is published for it, so these follow the documented shape:
 * https://bunny.net/docs/cdn/logging#logging-api-v2
 */

/** Query parameters for `GET /v2/pullzones/{pullZoneId}/logs`. Comma lists are passed as one string. */
export interface LogsQuery {
  /** Inclusive start, ISO 8601 UTC. Defaults to `to - 24h`. */
  from?: string;
  /** Exclusive end, ISO 8601 UTC. Defaults to now. */
  to?: string;
  /** Exact codes or classes, e.g. `404,5xx`. */
  status?: string;
  /** e.g. `HIT,MISS`. */
  cacheStatus?: string;
  /** ISO 3166 alpha-2 codes, e.g. `EE,DE`. */
  country?: string;
  edgeLocation?: string;
  remoteIp?: string;
  urlContains?: string;
  userAgentContains?: string;
  refererContains?: string;
  search?: string;
  includeOriginShield?: boolean;
  /** 1 to 10000. Defaults to 100. */
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
  requestId?: string;
}

export interface LogEntry {
  timestamp: string;
  pullZoneId: number;
  requestId: string;
  cacheStatus: string;
  statusCode: number;
  bytesSent: number;
  remoteIp?: string | null;
  countryCode?: string | null;
  edgeLocation: string;
  scheme: string;
  host: string;
  path: string;
  url: string;
  userAgent?: string | null;
  referer?: string | null;
  ja4Fingerprint?: string | null;
  asn?: number | null;
  asnOrganization?: string | null;
  /** Extended logging only. */
  bodyBytesSent?: number;
  contentRange?: string | null;
  authorizationHeader?: string | null;
}

export interface LogsResponse {
  data: LogEntry[];
  pagination: {
    offset: number;
    limit: number;
    returned: number;
    hasMore: boolean;
  };
  query: {
    pullZoneId: number;
    from: string;
    to: string;
    order: "asc" | "desc";
  };
}

export interface paths {
  "/v2/pullzones/{pullZoneId}/logs": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: LogsQuery;
        header?: never;
        path: { pullZoneId: number };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        200: {
          headers: { [name: string]: unknown };
          content: { "application/json": LogsResponse };
        };
      };
    };
  };
}
