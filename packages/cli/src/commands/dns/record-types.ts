// Record type helpers live in @bunny.net/actions; this shim keeps CLI-local import paths stable.
export type { DnsRecordModel, DnsRecordTypes } from "@bunny.net/actions";
export {
  CAA_TAGS,
  formatRecordValue,
  parseRecordType,
  RECORD_TYPE_META,
  RECORD_TYPES,
  recordName,
  recordTypeLabel,
} from "@bunny.net/actions";
