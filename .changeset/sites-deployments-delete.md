---
"@bunny.net/cli": patch
---

feat(sites): `sites deployments delete <id>` deletes a single deploy — its preview zone, files, and record — for CI cleanup of a closed PR's preview; the live deploy and the rollback target are refused, and deleting an already-gone ID is a no-op success
