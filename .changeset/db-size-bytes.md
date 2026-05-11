---
"@bunny.net/cli": patch
---

`bunny db show`, `bunny db usage`, and `bunny db list` now read the new integer `current_size_bytes` / `size_max_bytes` fields from the database API and format them locally, instead of round-tripping the deprecated pre-formatted string fields through a parser. Storage values are no longer subject to the precision loss from re-parsing `"20.5 KB"`-style strings.
