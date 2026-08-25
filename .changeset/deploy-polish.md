---
"@bunny.net/cli": patch
---

Four smaller things around `bunny sites deploy`.

- `--name <name>` is honoured when the deploy creates the site. Without it an
  unattended run stopped with "No site specified and no linked site found."
- `--region <code>` chooses the storage region for a site the deploy creates.
  Only `sites create` could name one before.
- The domain prompt after a first deploy refuses a value that is not a hostname,
  and says so. It used to send it, and the API's answer is `An error has
  occurred.`
- The upload counts bytes as well as files. `withastro/astro.build` sends 1.4 GB
  in 8828 files, and ten minutes of `4210/8828 files` says nothing about how much
  is left.
