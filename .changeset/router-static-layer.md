---
"@bunny.net/cli": minor
---

Serve a static site's 404 page, redirects, and headers from the router.

The router reads three file names out of the deploy it is serving: `404.html`,
`_redirects`, and `_headers`. Cloudflare Pages and Netlify read the same three,
so nothing in the router knows about a framework and every preset gets it.

- **`404.html`** answers a path the deploy does not hold, at status 404. Without
  it the pull zone answers with bunny.net's error page, whatever the site built.
  That shipped: a documentation site went up and every wrong URL showed
  bunny.net's page.
- **`_redirects`** sends a real redirect. One rule per line, `/from /to [status]`,
  `#` comments, a trailing `*` captured as `:splat`, and `!` to beat a file at the
  same path. 301 is the default status; 302, 303, 307 and 308 are read too. A
  rewrite (`200`) is not: it would have the router fetch another path of its own
  site, which can be made to loop.
- **`_headers`** carries the headers Bunny Storage cannot hold. A `/path` line
  opens a block, `Name: value` lines under it belong to it, and a later block
  wins the same name.

A rule and a header match on a trailing-slash-normalised path, so `/about` and
`/about/` are one rule. The rules are read once per deploy and held in memory,
never written into the script, so a publish stays an environment variable change.

The router now sets `Cache-Control` on every response, and a site's pull zone
stops overriding it (`CacheControlMaxAgeOverride: -1`). The zone default of 30
days replaced every answer the script gave, so an HTML page could be a month
stale in a browser that no purge reaches. A page now gets 60 seconds, anything
else 30 days as before, and `_headers` wins where it says anything.
`bunny sites upgrade-router` applies the router and the setting together, and
`bunny sites deploy` does it for a site whose router lags.
