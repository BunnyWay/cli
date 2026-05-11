---
"@bunny.net/openapi-client": patch
"@bunny.net/cli": patch
---

Update OpenAPI specs and align CLI with new enum casing.

- `database` spec bumped to `0.0.130`: adds `size_max_bytes` / `current_size_bytes`, deprecates the string `size_max` / `current_size`.
- `magic-containers` spec bumped to `v1.9.19.0`: adds `/apps/{appId}/summary` and `/nodes/plain` endpoints, `DeleteApplication` is now async, and several enums (`ApplicationStatus`, `ApplicationRuntimeType`, `AddRegistryStatus`, `RemoveRegistryStatus`, `AnycastIpProtocolVersion`) switched to lowercase / camelCase values.
- `core` spec: adds External DNS certificate request/complete endpoints and new Stream Video Library / Storage Zone operations; pull-zone and storage-zone list operation IDs renamed (`Index` → `IndexAll`).
- `bunny apps list` now correctly maps the lowercase `ApplicationStatus` values (`active`, `progressing`, etc.) to display labels; previously a recent API change caused the column to fall through to the raw status string.
