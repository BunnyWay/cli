# Lab Commands

`bunny lab` holds commands we are still shaping. The name is the warning: the
interface can change between releases, so a workflow built on one should expect
to be updated. The namespace is hidden from help and from the landing page.

## Astro

Two commands, and no more:

```bash
bunny lab deploy astro [dir]     # build this project, then deploy it
bunny lab undeploy astro [dir]   # delete the app and the resources it runs on
```

Server-side rendering only. A static Astro build is a directory of files, and
`bunny sites deploy` deploys one; this command refuses it and says so.

Nothing here touches `bunny sites`. The two commands deploy different shapes, and
an app made by one is invisible to the other.

### What it makes

Three resources, named after the app:

| Resource     | Name                          | Holds                          |
| ------------ | ----------------------------- | ------------------------------ |
| Storage zone | `astro-<app>-<suffix>`        | The client build, per deploy   |
| Edge Script  | `astro-<app>-<suffix>-server` | Astro's server, standalone     |
| Pull zone    | `astro-<app>-<suffix>`        | The hostname, script as origin |

The script is the pull zone's origin, so nothing sits between a request and the
code. The client build lives at `deploys/<id>/` in the storage zone, and the
deploy's own folder name is written into the top of the bundle, so a release can
only read the files it was built against.

`.bunny/astro.json` in the project links the directory to those three resources.
It is a pointer, not a source of truth: `--name` finds the same resources by
name, which is what a fresh clone or a CI runner does.

### The deploy, in order

1. Find the project. A monorepo root is not one; it offers the projects below it.
2. Check the Astro version. The adapter needs Astro 7, and an older project stops
   here with the upgrade command.
3. Put `@bunny.net/astro-adapter` in. Another host's adapter is removed, from the
   config and from `package.json`.
4. Build, unless `--no-build`.
5. Read `.bunny/build.json`. It has to say `kind: "ssr"`.
6. Read the bundle. Over 10 MB the platform refuses it, so this refuses first.
7. Find or create the three resources. Each one is looked up before it is made,
   so a half-finished create re-runs cleanly.
8. Apply the pull zone settings the build asks for, and turn the zone's
   `CacheControlMaxAgeOverride` off. Without the last one the edge rewrites every
   `Cache-Control` the adapter sets.
9. Set the script's variables: the zone, its endpoint, its read-only password,
   and the pull zone ID. A build that uses `Astro.session` also gets a password
   that can write.
10. Upload the client build, then publish the code. In that order, always.
11. Purge, wait, purge. Without the second purge the command reports success
    while the site still serves the release before it.
12. Ask the site for its home page, and for a page it does not hold.
13. Delete every deploy folder but this one and the one before it.

### Flags

| Command    | Flag             | Does                                                           |
| ---------- | ---------------- | -------------------------------------------------------------- |
| `deploy`   | `--name`         | The app name. Default: the state file, then the package's name |
| `deploy`   | `--region`       | Storage region for a new app (default: DE)                     |
| `deploy`   | `--no-build`     | Deploy the build already on disk                               |
| `deploy`   | `--yes` / `-y`   | Add the adapter without asking                                 |
| `deploy`   | `--force`        | Deploy again when nothing changed                              |
| `undeploy` | `--name`         | The app to delete, with no state file                          |
| `undeploy` | `--keep-storage` | Keep the storage zone and every file in it                     |
| `undeploy` | `--force` / `-f` | Skip the prompts                                               |

`--output json` prints the deploy's ID, URL, sizes, and the variables it could
not set. An unchanged deploy prints `"unchanged": true` and changes nothing.

### What a user must change by hand

The CLI cannot do these:

- **Astro 7.** The adapter's peer range is `^7.0.0`. Upgrading a framework major
  is the developer's decision: run `npx @astrojs/upgrade`.
- **State in memory does not hold.** Each request may reach a different edge node
  and a different isolate, so a module-level `Map` or `let` is empty again on the
  next request. `Astro.session` replaces it, and writes to the storage zone.
- **A page must not fetch its own site to reach its own API route.** It works, but
  every page render becomes a second trip out through the CDN and back. Import the
  data instead.

Astro's own `security.checkOrigin` is on by default for `output: "server"`, so a
form POST with no `Origin` header answers 403. That is Astro, not the platform: a
browser sends the header, and `curl` has to be told to.

### Unattended runs

```bash
bunny lab deploy astro --name my-app --yes --output json
bunny lab undeploy astro --name my-app --force
```

`--yes` is needed because the adapter changes a `package.json` and an
`astro.config`. Without it, an unattended run prints the two changes and stops.
