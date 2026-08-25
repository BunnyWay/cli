---
"@bunny.net/cli": patch
---

fix(sites): `sites ci init` names the repository secret `BUNNYNET_API_KEY`, matching the environment variable the CLI reads, pins the generated workflow to a `deploy-site` action tag that exists.
