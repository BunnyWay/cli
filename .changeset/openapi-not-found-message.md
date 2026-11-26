---
"@bunny.net/openapi-client": patch
---

Export `NOT_FOUND_MESSAGE`, the message an `ApiError` carries for a 404 with no error body, so callers can tell a missing route from a missing resource without hard-coding the text.
