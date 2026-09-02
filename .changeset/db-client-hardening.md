---
"@bunny.net/database-client": patch
"@bunny.net/cli": patch
---

Harden `@bunny.net/database-client`: reject invalid `timeout` values, wrap a malformed pipeline response in `DatabaseError`, keep the underlying error as `cause`, send integer-valued doubles past 2^53 as REAL instead of throwing, and let `db.sql` carry a row type.
