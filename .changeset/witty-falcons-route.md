---
"@bunny.net/cli": minor
---

feat(scripts): point a custom domain at the pull zone via Bunny DNS automatically

When a custom domain added in `scripts create`/`init` belongs to one of your Bunny DNS zones, the CLI offers to add (or repoint) the DNS record for you — always after confirmation — then issues SSL immediately since the record is already live on bunny's resolvers.
