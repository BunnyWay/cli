---
"@bunny.net/cli": patch
---

`bunny sites deploy` asks the site for a page before it calls the deploy a
success.

A published Edge Script that will not start makes the edge answer 400 with an
empty body, and the deploy said nothing: a green line, a URL, and a site that
served nothing. `withastro/astro.build` deployed exactly like that.

The check probes the production URL up to three times, each with its own query so
the CDN cache cannot hold the answer. A redirect or a 404 counts as a working
script; only 400 and 5xx are faults, and a site that cannot be reached at all is
not called one.

A site that answers is then asked for a path it cannot hold. The answer has to be
the deploy's own `404.html`, because a pull zone with no error page of its own
answers a miss with bunny.net's. That shipped once, on a documentation site.

`--output json` carries `serving`, `status` when it is not, and `notFoundStatus`
when the 404 page did not answer.
