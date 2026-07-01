import type { components } from "./generated/core.d.ts";

/**
 * Hand-authored corrections for the DNS record-scan endpoints. The generator
 * models a scan's `Records` as `DnsZoneDiscoveredRecordModel`, which is lossy:
 * the runtime serializes the full record shape, so `Flags`/`Tag` (needed to
 * recreate CAA records) are in the JSON but absent from the generated type.
 * These types restore them and name the scan-status enum the spec leaves as a
 * bare `0 | 1 | 2 | 3`.
 */

/** Status of a background DNS record scan (spec: DnsZoneScanJobStatus). */
export enum DnsRecordScanStatus {
  Pending = 0,
  InProgress = 1,
  Completed = 2,
  Failed = 3,
}

/**
 * A record returned by a scan: the generated discovered model plus the writable
 * fields the runtime includes but the generator dropped (`Flags`/`Tag`).
 */
export type DnsDiscoveredRecord =
  components["schemas"]["DnsZoneDiscoveredRecordModel"] &
    Pick<components["schemas"]["DnsRecordModel"], "Flags" | "Tag">;

/** A scan job result with the corrected `Records` and a named `Status`. */
export interface DnsRecordScanJob
  extends Omit<
    components["schemas"]["DnsZoneRecordScanJobResponse"],
    "Records" | "Status"
  > {
  Status?: DnsRecordScanStatus | null;
  Records?: DnsDiscoveredRecord[] | null;
}

/** The response from triggering a scan, with a named `Status`. */
export interface DnsRecordScanTrigger
  extends Omit<
    components["schemas"]["DnsZoneRecordScanTriggerResponse"],
    "Status"
  > {
  Status?: DnsRecordScanStatus | null;
}
