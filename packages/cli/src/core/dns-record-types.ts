// Record type maps live in @bunny.net/actions; this shim keeps core import paths stable.
export type { DnsRecordTypes, RecordTypeGroup } from "@bunny.net/actions";
export {
  RECORD_TYPE_LABELS,
  RECORD_TYPE_META,
  RECORD_TYPES,
  recordTypeFromLabel,
  recordTypeLabel,
} from "@bunny.net/actions";
