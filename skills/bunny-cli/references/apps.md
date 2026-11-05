# Apps Commands (Magic Containers)

> **Preview**: `bunny apps` is in public preview; commands and flags may still change.

All app commands live under `bunny apps`. An app runs one or more containers on Magic Containers; containers in the same app share a localhost network. The app is described by a `bunny.jsonc` committed to the repo, and the app ID is written back to it on the first deploy, so a fresh clone can deploy straight away.

Commands find the app in this order:

1. `--id <app-id>`
2. `app.id` in `bunny.jsonc` (or the file passed with `--config`)
3. `.bunny/app.json` (written by `bunny apps link`)

## Typical workflows

```bash
# First deploy: the walkthrough asks for the source, registry, name, and region, then writes bunny.jsonc
bunny apps deploy

# Unattended first deploy from source (a Dockerfile is generated when there is none)
bunny apps deploy --dockerfile --region de --output json

# Deploy a pre-built image
bunny apps deploy ghcr.io/myorg/api:v1.2

# Later deploys: rebuild or redeploy whatever bunny.jsonc describes
bunny apps deploy

# Edit config without deploying
bunny apps pull                     # remote app -> bunny.jsonc
bunny apps push --dry-run           # what would change
bunny apps push                     # bunny.jsonc -> remote app
```

---

## `bunny apps deploy`: Build, push, and deploy

What you pass picks the mode:

| You pass              | What happens                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `<image>`             | Skip the build. Resolve a registry for the image's hostname and deploy the ref.                    |
| `--dockerfile [path]` | Build the Dockerfile (default `./Dockerfile`), push it to the container's registry, then deploy.   |
| Neither               | Use `bunny.jsonc`: build containers that set `dockerfile`, redeploy the pinned `image` for others. |

`<image>` and `--dockerfile` are mutually exclusive. With more than one container in `bunny.jsonc`, pass `--container <name>` alongside either.

With no `bunny.jsonc`, the first run walks through setup. It asks where the image comes from:

- **Build from local source**: a detected `Dockerfile`, or a generated one for a detected Node, Bun, Deno, Python, Go, Rust, Ruby, PHP, .NET, or Spring Boot app.
- **Pick an image from a connected registry**: choose the registry, image, and tag.
- **Deploy an image by URL**: enter a ref such as `ghcr.io/me/api:v1`.

A static site with no server is pointed at `bunny sites deploy` instead.

| Flag                    | Description                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `<image>`               | Image ref to deploy. Skips the build.                                                      |
| `--dockerfile [path]`   | Build from a Dockerfile. The bare flag uses `./Dockerfile` and generates one when missing. |
| `--context`             | Docker build context (default: the Dockerfile's directory).                                |
| `--tag`                 | Image tag (default: `<git-sha>-<timestamp>`).                                              |
| `--registry`            | Registry ID to push to, or `bunny` for the bunny.net registry. Overrides `bunny.jsonc`.    |
| `--container`           | Container to update when `bunny.jsonc` has more than one.                                  |
| `--name`                | App name for the first-run walkthrough.                                                    |
| `--region`              | Region ID for a new app. Required without a terminal.                                      |
| `--port`                | Container port. Also retargets the generated Dockerfile and endpoints.                     |
| `--command`             | Override the container `CMD` (one string, split on whitespace).                            |
| `--config <path>`       | Use this file instead of `./bunny.jsonc`. Created by the walkthrough if it doesn't exist.  |
| `--dry-run`             | Print the would-be `bunny.jsonc` and Dockerfile without writing or deploying.              |
| `--no-push`             | Build only. Skip the push and the deploy.                                                  |
| `--allow-split-volumes` | Allow a volume in more than one region or instance (each copy keeps separate data).        |
| `--force`, `-f`         | Remove containers or volumes that are no longer in `bunny.jsonc` without asking.           |

After a redeploy that replaced an image, the CLI prints the previous image and the command to roll back to it:

```
Previous image: ghcr.io/me/api:abc-123
To rollback:    bunny apps deploy ghcr.io/me/api:abc-123
```

### Deploying from an agent or CI

Without a terminal, or with `--output json`, the walkthrough never prompts. Questions with a default take it: the bunny.net registry, the suggested app name, suggested endpoints, and env keys from `.env` / `.env.example`. Two need flags: what to deploy (`--dockerfile` or an image) and `--region`. A missing one fails at once with a hint naming the flag.

```bash
bunny apps deploy --dockerfile --region de --output json
bunny apps deploy --config /tmp/task.jsonc --output json   # keep the config out of the repo
bunny apps delete --force --id "$(jq -r .app.id /tmp/task.jsonc)"
```

Pass `--force` whenever the config may drop a container or volume; without it, an unattended deploy fails instead of asking.

### Registries and Docker login

Every container is tied to a registry record, even for public images. Public `ghcr.io` and `docker.io` images use shared records bunny.net provides. For another hostname with no connected registry, the CLI asks for a username and token and adds it.

Before a build, the CLI checks that Docker is logged in to the registry as the registry's user. For `ghcr.io` it offers to log in with the GitHub CLI (`gh`); other hosts prompt for a username and token. The bunny.net registry authenticates with your API key, so it needs no Docker login.

---

## `bunny apps init`: Write bunny.jsonc without deploying

Runs the same walkthrough as `deploy` and stops once the config is written. Takes the same `<image>`, `--name`, `--region`, `--dockerfile`, `--registry`, `--port`, `--command`, and `--config` flags.

```bash
bunny apps init
bunny apps init ghcr.io/me/api:v1
bunny apps init --dockerfile --port 8080
```

## `bunny apps pull` / `bunny apps push`: Sync config

```bash
bunny apps pull              # overwrite bunny.jsonc with the remote app (asks first; --force skips)
bunny apps push --dry-run    # list added or removed containers, and endpoint and volume count changes
bunny apps push              # apply bunny.jsonc to the app (does not deploy)
bunny apps push --force      # also remove containers or volumes dropped from bunny.jsonc
```

Containers missing from `bunny.jsonc` are removed from the app, and missing volumes are removed with their data. `push` and `deploy` list these removals and ask first. Containers are matched by name, so reordering is safe and renaming one container at a time keeps it.

## `bunny apps env`: Environment variables

```bash
bunny apps env list
bunny apps env set DATABASE_URL postgres://db:5432/app --container api
bunny apps env remove OLD_VAR
bunny apps env pull                  # remote -> .env
bunny apps env push .env.prod        # merge the file into remote
bunny apps env push --replace        # drop remote vars not in the file
bunny apps env push --dry-run        # show + added, ~ changed, - removed
```

`--container` targets one container; the default is the primary.

## `bunny apps endpoints`: CDN and Anycast endpoints

```bash
bunny apps endpoints list
bunny apps endpoints add --type cdn --ssl --container-port 3000 --public-port 443
bunny apps endpoints add --type anycast --name tcp-api --container-port 5432 --public-port 5432
bunny apps endpoints remove <endpoint-id>
```

`add` and `remove` also update a linked `bunny.jsonc`, so the next push or deploy keeps the change. Names are unique per app; `--name` defaults to the type, numbered (`cdn-2`) when taken.

## `bunny apps registries`: Registries bunny.net pulls from

```bash
bunny apps registries list
bunny apps registries add --name "GitHub" --server ghcr.io --username myorg --password "$TOKEN"
bunny apps registries add --name scaleway --server rg.fr-par.scw.cloud --username nologin --password "$TOKEN"
bunny apps registries update <registry-id> --username myorg --password "$TOKEN"   # rotate credentials
bunny apps registries remove <registry-id>
```

`--server` sets the type: `gitHub` for ghcr.io, `dockerHub` for docker.io, and `oci` for any other host. Pass `--type gitHub|dockerHub|oci` to set it yourself; `oci` needs `--server`. The `Source` column marks each one as **Connected** (yours), **Public** (shared pull-through for docker.io and ghcr.io), or **bunny.net** (the platform registry, which can't be changed or removed).

## Other commands

```bash
bunny apps list                      # all apps
bunny apps show                      # status, regions, scaling, cost, containers
bunny apps link [app-id]             # link this directory to an existing app (.bunny/app.json)
bunny apps unlink
bunny apps restart
bunny apps undeploy --force          # stop the app, keep its config
bunny apps delete --force
bunny apps volumes list
bunny apps volumes remove <volume-id> --force
bunny apps regions list
bunny apps regions show
```

---

## `bunny.jsonc`

```jsonc
{
  "$schema": "./node_modules/@bunny.net/config/generated/schema.json",
  "version": "2026-05-11",
  "app": {
    "id": "app_xxx", // written on first deploy
    "name": "my-api",
    "regions": ["de"],
    "scaling": { "min": 1, "max": 3 },
    "containers": {
      "api": {
        "image": "ghcr.io/me/api:v1", // rewritten on each deploy
        "registry": "12345",
        "dockerfile": "Dockerfile", // optional: enables the build path
        "context": ".",
        "env": { "PORT": "3000" },
        "endpoints": [
          { "type": "cdn", "ssl": true, "ports": [{ "public": 443, "container": 3000 }] },
        ],
      },
    },
  },
}
```

- `regions` takes a list, or `{ "allowed": [...], "required": [...] }` to separate where the app may run from where it must run.
- An endpoint takes an optional `name`; without one it is named after its type.
- If `version` is missing, run `bunny apps pull` to regenerate the file.

## Volumes are never shared

Every region, and every instance within a region, gets its own empty volume, and nothing syncs between them. `deploy` and `push` refuse a config where a container mounts a volume and the app runs in more than one region or has `scaling.max` above 1. Keep one region and `scaling.max: 1` for a database, or pass `--allow-split-volumes` when separate data per copy is what you want, such as a cache.
