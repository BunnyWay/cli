---
"@bunny.net/cli": minor
---

feat(sites): deploys publish straight to production when no custom domain is attached; previews are now a custom-domain feature. Attaching a domain unlocks the preview/--production flow with per-deploy `dpl-{id}.preview.{domain}` URLs, which are root-served so client-side routers (TanStack Router, React Router) work exactly like production. The `/deploys/{id}/` path previews and the router's HTMLRewriter are gone: they broke SPA route matching, and old deploys are no longer publicly browsable (run `bunny sites upgrade-router` to pick this up on existing sites). `bunny sites ci init` now scaffolds PR preview deploys only when the site has a custom domain; without one the workflow deploys production on pushes to main only. A domainless site's first deploy offers to attach a custom domain (interactive runs; blank to skip, and it never re-asks), and later domainless deploys print a `sites domains add` hint instead.
