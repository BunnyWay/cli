---
"@bunny.net/cli": patch
---

`apps deploy` and `apps init` now detect Dockerfiles in monorepo subdirectories during the first-run walkthrough. When more than one is found you can multi-select to create one container per Dockerfile, and an "add another" prompt lets you include paths the scan missed.
