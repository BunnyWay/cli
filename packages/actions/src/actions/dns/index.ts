import type { Action } from "../../define-action.ts";
import { dnsRecordActions } from "./records.ts";
import { dnsZoneActions } from "./zones.ts";

export const dnsActions: Action[] = [...dnsZoneActions, ...dnsRecordActions];
