---
"@bunny.net/cli": patch
---

Prompts and spinners now render with `@clack/prompts` (on stderr, so a piped stdout only carries command output), and fewer manual steps between creating a resource and using it: `scripts env push` (and `env set --from-file`) sends a local `.env` to an Edge Script, picking which variables to push and which are secrets; storage `.env` writes now include `BUNNY_STORAGE_CDN_URL` and a lowercased `BUNNY_STORAGE_REGION` that the S3 endpoint accepts; `db create --mode auto|single|manual` answers the region prompt from the command line; `env set` asks whether a prompted value is a secret even when the name was given; and the lifecycle verbs follow one rule, with every previous spelling kept as an alias: `create` makes a new resource and `delete` destroys it (`storage zones create`/`delete`, `dns zone create`/`delete`), while `add` attaches something to an existing resource and `remove` takes it away again (`sandbox url remove`, `sandbox env remove`).
