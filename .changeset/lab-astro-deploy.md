---
"@bunny.net/cli": minor
"@bunny.net/config": minor
---

`bunny lab deploy astro` deploys an Astro project that renders pages per request.

Two commands, and no more:

```bash
bunny lab deploy astro
bunny lab undeploy astro
```

Astro's server becomes a standalone Edge Script. The client build goes into a
storage zone the script reads. The pull zone's origin is the script, so nothing
sits between a request and the code. The command provisions the three resources
on its first run, uploads the build, sets every variable from what it already
knows, applies the pull zone settings the adapter asks for, and publishes. No
password passes through the terminal.

`bunny sites deploy` goes back to deploying a directory of files. It used to do
both jobs, and the share was the problem: a project that renders per request
cannot use `CURRENT_DEPLOY`, because one script serves one release, and a
directory of files cannot use a build manifest. Each flow carried checks for the
shape it was not, and a reader could not tell which command applied to which
project. Nothing under `lab/` imports from `sites/` now.

`lab` says the interface is still being shaped. The namespace is hidden from help
and from the landing page, and a workflow built on either command should expect
to be updated.

Server-side rendering only. A static Astro build is a directory of files, and
this command refuses one and names the command that deploys it.

Measured against two real templates, deployed to a real account:
`withastro/astro/examples/ssr` and `render-examples/astro-ssr`. What that
changed:

- **Astro 7 is checked before the install.** The adapter's peer range is
  `^7.0.0`, and `render-examples/astro-ssr` ships Astro 5. npm answers that with
  an ERESOLVE about peer ranges, which tells a developer nothing to act on. The
  command stops first, and names `npx @astrojs/upgrade`. Upgrading a framework
  major stays the developer's decision.
- **The adapter it replaces is uninstalled, not only unimported.**
  `@astrojs/node@9` peers on `astro@^5`, so after an upgrade to Astro 7 it makes
  every later install in that project fail. Replacing the adapter in the config
  and leaving the package in `package.json` left the project broken in a way
  nothing explained.
- **The pull zone's cache override goes off.** With the zone default in place the
  edge rewrites every `Cache-Control` the adapter sets, so an HTML page would sit
  a month stale in a browser that a purge cannot reach.
- **The state file belongs to the project, not to the working directory.**
  `bunny lab deploy astro ./project` run from anywhere else found no state,
  decided the app was new, and created a second set of resources beside the first.
- **The prefix is not added twice.** An app called `astro-ssr-demo` became
  `astro-astro-ssr-demo-a1b2c3`, which reads like a mistake and spends six
  characters of a 63-character DNS label on nothing.

The deploy asks the site for its home page, and for a path it does not hold,
before it calls itself a success. Above 7.5 MB the warning says why a script
answers 400: measured in August 2026, the same code served every request at
7.44 MB and none at 7.83 MB, well under the documented 10 MB.

Each deploy's files live at `deploys/{id}/`, and the folder's name is written into
the top of the bundle at publish time, so a release can only read the files it was
built against. There is no rollback, so every folder but the current one and the
one before it is deleted after a publish.

`bunny lab undeploy astro` deletes the pull zone, the script, and the storage
zone. `--keep-storage` keeps the files. It lists what will go before it asks, and
`--name` finds the same resources with no state file, which is the fresh-clone and
CI case.

`BuildManifestSchema` in `@bunny.net/config` is the contract with the adapter. The
CLI knows no framework: it reads the manifest.
