---
"@bunny.net/cli": patch
---

feat(dns): `dns zones add` now scans for existing records automatically, then offers a next-steps menu (upload a zone file, add records manually, or continue to nameserver setup) so you can fully populate the zone before delegating; `--import` imports scanned records without prompting and `--no-import` skips the scan and menu
