---
"@bunny.net/cli": patch
---

`apps deploy` now prints where the app is reachable once the deploy completes — an `https://`/`http://` URL for CDN endpoints and the public IP for anycast/public-IP endpoints, per container. Endpoints whose IPs are still being assigned show as "provisioning…" with a pointer to `apps endpoints list`. The reachable targets are also included in `--output json`. The success line now reads "Your app was deployed successfully 🪄" and uses the bunny brand colour for its success marker.
