---
"@bunny.net/cli": patch
---

Fewer manual steps between creating a resource and using it: `scripts env push` (and `env set --from-file`) sends a local `.env` to an Edge Script, picking which variables to push and which are secrets; storage `.env` writes now include `BUNNY_STORAGE_CDN_URL` and a lowercased `BUNNY_STORAGE_REGION` that the S3 endpoint accepts; `db create --mode auto|single|manual` answers the region prompt from the command line; `env set` asks whether a prompted value is a secret even when the name was given; and `zones add`/`zone add` answer to `create`.
