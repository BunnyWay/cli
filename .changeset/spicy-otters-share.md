---
"@bunny.net/cli": patch
---

feat(dns): verify registrar delegation with a live nameserver lookup (instead of the API's NameserversDetected flag, which defaults to true on a fresh zone) across `dns zones ns`, `dns zones list`, and pull-zone setup; `dns zones add` and `ns` now give registrar-aware setup steps (registrar named via RDAP) and skip them when the domain is already delegated; add `dns records preset` with email, verification, and security presets (Google Workspace, Microsoft 365, Zoho, Mailgun, Resend, Proton, Bluesky, DMARC, CAA, no-email) plus a preset option in the `records add` wizard; color table heads bunny orange
