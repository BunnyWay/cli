---
"@bunny.net/openapi-client": patch
"@bunny.net/cli": patch
---

feat(dns): import a domain's existing records when moving to bunny: new `dns records scan [domain]` (server-side record scan, multiselect, bulk-write) and `dns zones add --import` offer the same migration right after creating the zone; a bad record is reported rather than stranding the batch, and CAA flags/tag survive via corrected `DnsDiscoveredRecord` types in `@bunny.net/openapi-client`
