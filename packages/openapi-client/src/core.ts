/**
 * Core API entrypoint: the client factory plus every type generated from the
 * core OpenAPI spec (`paths`, `components`, `operations`), so consumers can
 * write `import type { components } from "@bunny.net/openapi-client/core"`.
 */
export { createCoreClient } from "./core-client.ts";
export type {
  DnsDiscoveredRecord,
  DnsRecordScanJob,
  DnsRecordScanTrigger,
} from "./dns.ts";
export { DnsRecordScanStatus } from "./dns.ts";
export type * from "./generated/core.d.ts";
