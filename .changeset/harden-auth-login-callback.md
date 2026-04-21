---
"@bunny.net/cli": patch
---

Harden the `bunny login` loopback callback server

- Every response (success and error) now sets `Cache-Control: no-store`, so browsers don't persist the `?state=…&apiKey=…` URL to disk cache.
- Non-`GET` requests to `/callback` now return `405 Method Not Allowed` with an `Allow: GET` header instead of falling through and attempting to read query parameters.
