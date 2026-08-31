---
"@bunny.net/cli": minor
---

Sites are now served by pull zone edge rules instead of a router Edge Script (HTML revalidates in browsers on every view, deploy dirs are blocked at the edge), and `sites deploy --deploy-id` lets a deploy carry your own release identifier
