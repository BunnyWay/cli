// Delegation checking lives in @bunny.net/actions; this shim keeps core import paths stable.
export type { DelegationCheck, DelegationStatus } from "@bunny.net/actions";
export {
  BUNNY_NAMESERVERS,
  checkDelegation,
  checkDelegations,
  expectedNameservers,
} from "@bunny.net/actions";
