---
"@bunny.net/cli": minor
---

Sites are now served by pull zone edge rules instead of a router Edge Script (HTML revalidates in browsers on every view, deploy dirs are blocked at the edge), `sites deploy --deploy-id` lets a deploy carry your own release identifier, and interactive `db create` now always generates an auth token (use `--no-token` to skip) and asks to save it to `.env`
